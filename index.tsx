import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Types
type TreatmentStep = {
  step: number;
  action: string;
  timing: string;
  details: string;
};

type Issue = {
  name: string;
  severity: "Low" | "Medium" | "High" | "None";
  confidence: string;
  explanation: string;
  treatmentPlan: TreatmentStep[];
};

type AnalysisResult = {
  overallStatus: string;
  issues: Issue[];
  safetyTips: string[];
  followUp: string;
};

type FileItem = {
  id: string;
  file: File;
  previewUrl: string;
  mimeType: string;
  loading: boolean;
  result: AnalysisResult | null;
  error: string | null;
};

const App = () => {
  const [items, setItems] = useState<FileItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // When selectedId changes, scroll to top of main view?
  const mainPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (mainPanelRef.current) {
      mainPanelRef.current.scrollTop = 0;
    }
  }, [selectedId]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      processFiles(Array.from(files));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const compressImage = async (file: File): Promise<{ data: string; mimeType: string }> => {
    return new Promise((resolve, reject) => {
      // If it's not an image (e.g. PDF), read as is
      if (!file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (e) => {
           const result = e.target?.result as string;
           const base64 = result.split(',')[1];
           resolve({ data: base64, mimeType: file.type });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }

      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1024;
          const MAX_HEIGHT = 1024;
          let width = img.width;
          let height = img.height;

          // Resize logic
          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error("Could not get canvas context"));
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          
          // Compress to JPEG with 0.7 quality
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          const base64 = dataUrl.split(',')[1];
          resolve({ data: base64, mimeType: 'image/jpeg' });
        };
        img.onerror = (error) => reject(error);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const processFiles = (files: File[]) => {
    const newItems: FileItem[] = [];

    files.forEach((file) => {
      // Basic validation
      if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
        alert(`File ${file.name} is not supported. Please use JPG, PNG, or PDF.`);
        return;
      }

      const id = Math.random().toString(36).substring(7);
      
      const newItem: FileItem = {
        id,
        file,
        previewUrl: URL.createObjectURL(file),
        mimeType: file.type,
        loading: true,
        result: null,
        error: null,
      };

      newItems.push(newItem);
    });

    setItems((prev) => [...prev, ...newItems]); // Add to end
    
    if (newItems.length > 0) {
        setSelectedId(newItems[0].id); // Select the first new item
        
        // Trigger analysis with compression
        newItems.forEach(async (item) => {
            try {
                const { data, mimeType } = await compressImage(item.file);
                analyzeItem(item.id, data, mimeType);
            } catch (error) {
                console.error("Compression error:", error);
                setItems(prev => prev.map(i => i.id === item.id ? { ...i, loading: false, error: "Failed to process image." } : i));
            }
        });
    }
  };

  const analyzeItem = async (id: string, base64Data: string, mimeType: string) => {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data,
              },
            },
            {
              text: `You are GreenCare, an expert agricultural assistant. Analyze this plant leaf (image or document). 
              
              Task:
              1. Determine the overall health status.
              2. Identify ALL distinct issues (diseases, pests, deficiencies, or damage). If multiple exist, list them separately.
              3. For EACH issue:
                 - Identify the specific name.
                 - Assign a Severity (Low, Medium, High).
                 - Estimate a confidence score (percentage string, e.g., "95%").
                 - Provide a simple explanation.
                 - Provide a DETAILED step-by-step treatment plan.
              4. Provide general Safety Tips (e.g., gloves, washing hands, disposal).
              5. Provide Follow-up advice (monitoring, when to expect recovery).
              
              If the plant is Healthy, the treatment plan should be empty.
              Do not give medical advice for humans. Keep language student-friendly but detailed.`,
            },
          ],
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallStatus: {
                type: Type.STRING,
                description: "Overall health status: 'Healthy', 'Diseased', or 'Unknown'.",
              },
              issues: {
                type: Type.ARRAY,
                description: "List of identified issues. If healthy, include one item 'Healthy Plant'.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Name of the disease/issue" },
                    severity: { type: Type.STRING, enum: ["Low", "Medium", "High", "None"] },
                    confidence: { type: Type.STRING, description: "Confidence score (e.g. '98%')" },
                    explanation: { type: Type.STRING, description: "Simple explanation of the issue" },
                    treatmentPlan: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          step: { type: Type.NUMBER },
                          action: { type: Type.STRING },
                          timing: { type: Type.STRING },
                          details: { type: Type.STRING }
                        },
                        required: ["step", "action", "timing", "details"]
                      }
                    }
                  },
                  required: ["name", "severity", "confidence", "explanation", "treatmentPlan"]
                }
              },
              safetyTips: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "List of safety precautions for handling this plant."
              },
              followUp: {
                type: Type.STRING,
                description: "Advice on monitoring and future care."
              }
            },
            required: ["overallStatus", "issues", "safetyTips", "followUp"],
          },
        },
      });

      const text = response.text;
      if (text) {
        const resultData = JSON.parse(text);
        setItems((prev) =>
          prev.map((item) =>
            item.id === id ? { ...item, loading: false, result: resultData } : item
          )
        );
      } else {
        throw new Error("No response from AI");
      }
    } catch (err: any) {
      console.error(err);
      let errorMessage = "Failed to analyze. Please try again.";
      if (err.message) {
          if (err.message.includes("403")) errorMessage = "Permission Denied: Please check API Key or Network.";
          else if (err.message.includes("503")) errorMessage = "Service temporarily unavailable. Retrying might help.";
          else errorMessage = `Error: ${err.message.slice(0, 50)}...`;
      }
      
      setItems((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, loading: false, error: errorMessage }
            : item
        )
      );
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const removeItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems((prev) => {
        const newItems = prev.filter((item) => item.id !== id);
        if (selectedId === id) {
             setSelectedId(newItems.length > 0 ? newItems[0].id : null);
        }
        return newItems;
    });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'low': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default: return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  const selectedItem = items.find(item => item.id === selectedId);

  return (
    <div className="flex h-screen h-[100dvh] bg-green-50 overflow-hidden">
      {/* Hidden Input */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,application/pdf"
        multiple
        onChange={handleFileChange}
      />

      {/* Left Sidebar (List View on Mobile) */}
      <aside className={`
          ${selectedId ? 'hidden md:flex' : 'flex'} 
          w-full md:w-80 
          bg-white border-r border-green-100 flex-col flex-shrink-0 shadow-xl z-20 transition-all
      `}>
        <div className="p-6 border-b border-green-50 bg-green-50/30">
            <div className="flex items-center space-x-3 mb-1">
                <div className="flex items-center justify-center w-10 h-10 bg-green-600 text-white rounded-xl shadow-lg shadow-green-200">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                </div>
                <h1 className="text-xl font-extrabold text-green-800 tracking-tight">GreenCare</h1>
            </div>
            <p className="text-xs text-green-600 font-medium ml-1">Plant Health Assistant</p>
        </div>

        {/* Thumbnails List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
            {items.map((item) => (
                <div 
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`relative p-3 md:p-2 rounded-xl border-2 cursor-pointer transition-all duration-200 group flex items-center space-x-4 md:space-x-3
                        ${selectedId === item.id 
                            ? 'border-green-500 bg-green-50 shadow-md ring-1 ring-green-200' 
                            : 'border-transparent bg-white hover:bg-gray-50 hover:border-green-200 shadow-sm md:shadow-none'}`}
                >
                    {/* Thumbnail */}
                    <div className="w-16 h-16 md:w-14 md:h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 border border-gray-200">
                         {item.mimeType === "application/pdf" ? (
                            <div className="w-full h-full flex items-center justify-center text-red-500 bg-red-50">
                                <span className="text-[10px] font-bold">PDF</span>
                            </div>
                          ) : (
                            <img src={item.previewUrl} className="w-full h-full object-cover" alt="thumb" />
                          )}
                    </div>
                    
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                         <p className={`text-base md:text-sm font-semibold truncate ${selectedId === item.id ? 'text-green-900' : 'text-gray-700'}`}>
                            {item.file.name}
                         </p>
                         <div className="flex items-center mt-1">
                            {item.loading ? (
                                <span className="text-xs text-green-600 animate-pulse">Analyzing...</span>
                            ) : item.error ? (
                                <span className="text-xs text-red-500">Error</span>
                            ) : (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                                    item.result?.overallStatus === 'Healthy' 
                                        ? 'bg-green-100 text-green-700' 
                                        : 'bg-red-100 text-red-700'
                                }`}>
                                    {item.result?.overallStatus}
                                </span>
                            )}
                         </div>
                    </div>

                    {/* Remove Button */}
                    <button 
                        onClick={(e) => removeItem(item.id, e)}
                        className="md:opacity-0 md:group-hover:opacity-100 p-2 md:p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-all"
                        title="Remove"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-4 md:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                    
                    {/* Mobile Chevron */}
                    <div className="md:hidden text-gray-300">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                    </div>
                </div>
            ))}

            {items.length === 0 && (
                <div className="text-center py-20 px-4">
                    <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                         </svg>
                    </div>
                    <p className="text-lg font-medium text-gray-600">No samples yet</p>
                    <p className="text-sm text-gray-400 mt-1">Upload a plant image to get started</p>
                </div>
            )}
        </div>

        {/* Add Button Area */}
        <div className="p-4 border-t border-green-100 bg-gray-50">
             <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white py-4 md:py-3 px-4 rounded-xl font-bold md:font-semibold shadow-lg shadow-green-200 transition-colors duration-200 active:transform active:scale-95"
             >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>Upload New Sample</span>
             </button>
        </div>
      </aside>

      {/* Main Panel (Detail View on Mobile) */}
      <main 
        className={`
            ${selectedId ? 'flex' : 'hidden md:flex'} 
            flex-1 flex-col overflow-y-auto bg-green-50/50 relative md:static fixed inset-0 z-30
        `}
        ref={mainPanelRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Mobile Back Header */}
        {selectedId && (
            <div className="md:hidden sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100 px-4 py-3 flex items-center shadow-sm">
                <button 
                    onClick={() => setSelectedId(null)}
                    className="flex items-center text-gray-600 hover:text-green-700 font-bold"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back to Samples
                </button>
            </div>
        )}

        {!selectedItem ? (
            <div className="h-full flex flex-col items-center justify-center p-10 text-center opacity-60 hover:opacity-100 transition-opacity border-4 border-dashed border-green-200/50 hover:border-green-300 m-8 rounded-3xl">
                 <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                 </div>
                 <h2 className="text-3xl font-bold text-green-900 mb-2">Ready to Analyze</h2>
                 <p className="text-lg text-green-700 max-w-md">
                    Select a file from the sidebar or drag & drop a new image here to get started.
                 </p>
            </div>
        ) : (
            <div className="max-w-5xl mx-auto md:p-10 min-h-full w-full">
                {/* Content Card */}
                <div className="bg-white md:rounded-3xl shadow-xl overflow-hidden border border-green-100 min-h-screen md:min-h-0">
                    
                    {/* Image Header */}
                    <div className="relative h-64 md:h-80 bg-gray-900 flex items-center justify-center group">
                        {selectedItem.mimeType === "application/pdf" ? (
                            <div className="text-white text-center">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-20 w-20 mx-auto mb-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 2H7a2 2 0 00-2 2v15a2 2 0 002 2z" />
                                </svg>
                                <p className="text-lg font-medium">{selectedItem.file.name}</p>
                            </div>
                        ) : (
                            <img src={selectedItem.previewUrl} alt="Preview" className="w-full h-full object-contain" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60"></div>
                        <div className="absolute bottom-4 left-6 text-white max-w-[80%]">
                            <h2 className="text-2xl font-bold drop-shadow-md truncate">{selectedItem.file.name}</h2>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="p-6 md:p-8">
                        {selectedItem.loading ? (
                            <div className="py-20 flex flex-col items-center justify-center">
                                <div className="animate-spin rounded-full h-16 w-16 border-4 border-green-100 border-t-green-600 mb-6"></div>
                                <h3 className="text-2xl font-bold text-green-900 animate-pulse">Analyzing Leaf...</h3>
                                <p className="text-gray-500 mt-2 text-center">Our AI is examining patterns and identifying issues</p>
                            </div>
                        ) : selectedItem.error ? (
                            <div className="py-12 flex flex-col items-center justify-center text-center">
                                <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-4">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                </div>
                                <h3 className="text-xl font-bold text-red-700">Analysis Failed</h3>
                                <p className="text-gray-600 mt-2 max-w-sm break-words">{selectedItem.error}</p>
                            </div>
                        ) : selectedItem.result ? (
                            <div className="space-y-10 animate-fade-in-up">
                                {/* Summary Header */}
                                <div className="flex items-center justify-between border-b border-gray-100 pb-6">
                                    <div>
                                        <span className="text-xs md:text-sm font-semibold text-gray-400 uppercase tracking-wider">Overall Status</span>
                                        <div className="flex items-center gap-3 mt-1">
                                            <h2 className={`text-2xl md:text-3xl font-extrabold ${
                                                selectedItem.result.overallStatus === 'Healthy' ? 'text-green-700' : 'text-red-700'
                                            }`}>
                                                {selectedItem.result.overallStatus}
                                            </h2>
                                        </div>
                                    </div>
                                    <div className={`w-14 h-14 md:w-16 md:h-16 rounded-full flex items-center justify-center flex-shrink-0 ${
                                        selectedItem.result.overallStatus === 'Healthy' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'
                                    }`}>
                                        {selectedItem.result.overallStatus === 'Healthy' ? (
                                             <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                            </svg>
                                        ) : (
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                        )}
                                    </div>
                                </div>

                                {/* Issues Breakdown */}
                                <div className="space-y-8">
                                    {selectedItem.result.issues.map((issue, idx) => (
                                        <div key={idx} className="bg-gray-50 rounded-2xl p-5 md:p-8 border border-gray-100 relative overflow-hidden">
                                            <div className="absolute top-0 left-0 w-1.5 h-full bg-green-500"></div>
                                            
                                            <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                                                <div>
                                                    <h3 className="text-xl md:text-2xl font-bold text-gray-900">{issue.name}</h3>
                                                    <p className="text-gray-600 mt-2 leading-relaxed text-sm md:text-base">{issue.explanation}</p>
                                                </div>
                                                <div className="flex flex-col items-end gap-2">
                                                    {issue.severity !== 'None' && (
                                                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${getSeverityColor(issue.severity)}`}>
                                                            {issue.severity} Severity
                                                        </span>
                                                    )}
                                                    {issue.confidence && (
                                                        <span className="text-xs font-semibold text-gray-400 bg-white px-2 py-1 rounded-md border border-gray-200 shadow-sm whitespace-nowrap">
                                                            {issue.confidence} Confidence
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Plan */}
                                            {issue.treatmentPlan && issue.treatmentPlan.length > 0 && (
                                                <div className="mt-8 bg-white rounded-xl p-5 md:p-6 shadow-sm border border-gray-100">
                                                    <h4 className="font-bold text-green-800 mb-6 flex items-center border-b border-gray-100 pb-2">
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                                                        </svg>
                                                        Treatment Plan
                                                    </h4>
                                                    <div className="space-y-6">
                                                        {issue.treatmentPlan.map((step) => (
                                                            <div key={step.step} className="flex gap-4">
                                                                <div className="flex flex-col items-center">
                                                                    <div className="w-8 h-8 rounded-full bg-green-600 text-white flex items-center justify-center font-bold text-sm shadow-md flex-shrink-0">
                                                                        {step.step}
                                                                    </div>
                                                                    <div className="w-0.5 h-full bg-gray-100 mt-2"></div>
                                                                </div>
                                                                <div className="pb-2">
                                                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                                                        <h5 className="font-bold text-gray-900 text-sm md:text-base">{step.action}</h5>
                                                                        <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded-full uppercase tracking-wide">{step.timing}</span>
                                                                    </div>
                                                                    <p className="text-gray-600 text-sm">{step.details}</p>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Bottom Info */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-8 md:pb-0">
                                    <div className="bg-yellow-50 rounded-2xl p-6 border border-yellow-100">
                                        <h4 className="font-bold text-yellow-800 mb-4 flex items-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            Safety Precautions
                                        </h4>
                                        <ul className="space-y-3">
                                            {selectedItem.result.safetyTips.map((tip, i) => (
                                                <li key={i} className="flex items-start text-sm text-yellow-900/80">
                                                    <span className="mr-2 text-yellow-500">•</span>
                                                    {tip}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                    <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                                         <h4 className="font-bold text-blue-800 mb-4 flex items-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                            </svg>
                                            Follow-Up Care
                                        </h4>
                                        <p className="text-sm text-blue-900/80 leading-relaxed">
                                            {selectedItem.result.followUp}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);