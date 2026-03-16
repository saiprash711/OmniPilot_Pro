import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Play, Loader2, X, Terminal, MousePointerClick, Keyboard, Navigation, Mouse, Clock, Code, CheckCircle2, MonitorUp, Mic, MicOff, Key, Globe, RefreshCw } from 'lucide-react';
import { generateActions, executeWithPuppeteer, extractUrlFromImage, Action } from './OmniPilotService';

export default function App() {
  const [image, setImage] = useState<{ url: string; base64: string; mimeType: string } | null>(null);
  const [command, setCommand] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [targetUrl, setTargetUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'actions' | 'code' | 'execution'>('actions');
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);
  const [isInteractiveMode, setIsInteractiveMode] = useState(false);
  const [interactiveInput, setInteractiveInput] = useState('');
  
  // Live Features State
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [isFetchingWebsite, setIsFetchingWebsite] = useState(false);

  const fetchWebsiteScreenshot = async (url: string) => {
    setIsFetchingWebsite(true);
    setError(null);
    try {
      const response = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch website';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) {
          errorMessage = `Server error (${response.status})`;
        }
        throw new Error(errorMessage);
      }
      
      let data;
      try {
        data = await response.json();
      } catch (e) {
        throw new Error('Received invalid response from server');
      }

      const match = data.screenshot?.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        setImage({
          url: data.screenshot,
          mimeType: match[1],
          base64: match[2],
        });
        setActions(null);
      } else {
        throw new Error('Invalid screenshot data received');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch website screenshot');
    } finally {
      setIsFetchingWebsite(false);
    }
  };

  // Clean up screen share on unmount
  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { displaySurface: 'browser' } 
      });
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setIsScreenSharing(true);
      
      // Listen for user stopping the share via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error("Error sharing screen:", err);
      setError("Could not start screen share. Please check permissions.");
    }
  };

  const stopScreenShare = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsScreenSharing(false);
  };

  const captureFrame = () => {
    if (!videoRef.current) return;
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    
    const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (match) {
      setImage({
        url: dataUrl,
        mimeType: match[1],
        base64: match[2],
      });
      setActions(null);
      setError(null);
    }
  };

  const toggleVoiceCommand = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    // @ts-ignore - SpeechRecognition is not fully typed in standard lib
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join('');
      setCommand(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const match = result.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        setImage({
          url: result,
          mimeType: match[1],
          base64: match[2],
        });
        setActions(null);
        setError(null);
        if (isScreenSharing) stopScreenShare();
      }
    };
    reader.readAsDataURL(file);
  };

  const clearImage = () => {
    setImage(null);
    setActions(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleReset = () => {
    setImage(null);
    setCommand('');
    setActions(null);
    setExecutionResult(null);
    setTargetUrl('');
    setError(null);
    setActiveTab('actions');
    setHoveredStep(null);
    if (isScreenSharing) stopScreenShare();
    setIsListening(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleGenerate = async () => {
    // If screen sharing is active and no image is captured yet, capture one now
    if (isScreenSharing && !image) {
      captureFrame();
      // Small delay to ensure state updates (in a real app, we'd await the capture)
      setTimeout(() => executeGeneration(), 100);
    } else {
      executeGeneration();
    }
  };

  const executeGeneration = async () => {
    // We need to grab the latest image state, so we use a ref or just rely on the re-render
    // For simplicity, if we just captured, the state might not be ready in this exact tick.
    // In a robust app, captureFrame would return the image data. Let's assume it's ready or we use the existing one.
    
    // To fix the race condition, let's grab directly from canvas if sharing
    let currentBase64 = image?.base64;
    let currentMime = image?.mimeType;

    if (isScreenSharing && videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const match = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (match) {
          currentBase64 = match[2];
          currentMime = match[1];
          // Update UI to show what was captured
          setImage({ url: dataUrl, mimeType: currentMime, base64: currentBase64 });
        }
      }
    }

    if (!currentBase64 || !command.trim()) {
      setError("Please provide an image/screen and a command.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setActions(null);
    setActiveTab('actions');

    try {
      const result = await generateActions(currentBase64, currentMime!, command);
      
      if (!targetUrl && result.extractedUrl) {
        // Basic URL validation
        let url = result.extractedUrl;
        if (url.includes('.')) {
          if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
          }
          setTargetUrl(url);
        }
      }

      setActions(result.actions);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred while generating actions.';
      if (errorMessage.includes('429') || errorMessage.includes('RESOURCE_EXHAUSTED')) {
        setError('You have exceeded the free tier quota for the default API key. Please click "Set API Key" in the top right to use your own Gemini API key.');
      } else {
        setError(errorMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  };

    const handleExecutePuppeteer = async () => {
    if (!actions || actions.length === 0) return;
    
    setIsExecuting(true);
    setIsInteractiveMode(false);
    setError(null);
    setActiveTab('execution');
    setExecutionResult({ log: [], finalScreenshot: null });

    try {
      let urlToUse = targetUrl;
      
      if (!urlToUse && image) {
        const extractedUrl = await extractUrlFromImage(image.base64, image.mimeType);
        if (extractedUrl) {
          urlToUse = extractedUrl;
          setTargetUrl(extractedUrl);
        } else {
          throw new Error("Could not extract URL from the image. Please enter it manually.");
        }
      } else if (!urlToUse) {
        throw new Error("Please enter a target URL or provide an image with an address bar.");
      }

      if (!urlToUse.startsWith('http://') && !urlToUse.startsWith('https://')) {
        urlToUse = 'https://' + urlToUse;
        setTargetUrl(urlToUse);
      }

      await executeWithPuppeteer(
        urlToUse, 
        actions,
        (newLog) => {
          setExecutionResult(prev => prev ? { ...prev, log: [...prev.log, newLog] } : { log: [newLog], finalScreenshot: null });
        },
        (newScreenshot) => {
          setExecutionResult(prev => prev ? { ...prev, finalScreenshot: newScreenshot } : { log: [], finalScreenshot: newScreenshot });
        },
        () => {
          setIsExecuting(false);
          setIsInteractiveMode(true);
        }
      );
      setIsExecuting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while executing actions.');
      setIsExecuting(false);
    }
  };

  const handleInteractiveClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isInteractiveMode) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 1280;
    const y = ((e.clientY - rect.top) / rect.height) * 800;
    
    try {
      await fetch('/api/puppeteer/interact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'click', x, y })
      });
    } catch (err) {
      console.error("Failed to send click:", err);
    }
  };

  const handleInteractiveType = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && interactiveInput) {
      try {
        await fetch('/api/puppeteer/interact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'type', text: interactiveInput })
        });
        setInteractiveInput('');
      } catch (err) {
        console.error("Failed to send type:", err);
      }
    }
  };

  const handleCloseSession = async () => {
    try {
      await fetch('/api/puppeteer/close', { method: 'POST' });
      setIsInteractiveMode(false);
      setExecutionResult(prev => prev ? { ...prev, log: [...prev.log, "Session closed."] } : null);
    } catch (err) {
      console.error("Failed to close session:", err);
    }
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'click': return <MousePointerClick className="w-4 h-4 text-blue-400" />;
      case 'type': return <Keyboard className="w-4 h-4 text-emerald-400" />;
      case 'press': return <Keyboard className="w-4 h-4 text-emerald-400" />;
      case 'navigate': return <Navigation className="w-4 h-4 text-purple-400" />;
      case 'scroll': return <Mouse className="w-4 h-4 text-amber-400" />;
      case 'wait': return <Clock className="w-4 h-4 text-slate-400" />;
      default: return <Terminal className="w-4 h-4 text-slate-400" />;
    }
  };

  const generatePuppeteerCode = (actions: Action[]) => {
    let code = `import puppeteer from 'puppeteer';\n\n(async () => {\n  const browser = await puppeteer.launch({ headless: false });\n  const page = await browser.newPage();\n\n`;
    
    actions.forEach((action, i) => {
      const safeComment = action.target.value.replace(/\n/g, ' ');
      const safeString = action.target.value.replace(/'/g, "\\'").replace(/\n/g, '\\n');
      
      code += `  // Step ${i + 1}: ${action.action} on ${safeComment}\n`;
      if (action.reasoning) {
        code += `  // Reasoning: ${action.reasoning.replace(/\n/g, ' ')}\n`;
      }
      code += `  await new Promise(r => setTimeout(r, 2000)); // Wait before action to ensure page is ready\n`;

      switch (action.action) {
        case 'navigate':
          code += `  await page.goto('${safeString}', { waitUntil: 'networkidle2' });\n`;
          break;
        case 'click':
          if (action.coordinates) {
            code += `  // Note: Coordinates [${action.coordinates[0]}, ${action.coordinates[1]}] on 1000x1000 grid\n`;
            code += `  // You would need to map these to viewport coordinates to use page.mouse.click(x, y)\n`;
            code += `  await page.evaluate(() => {\n    const el = Array.from(document.querySelectorAll('*')).find(e => e.textContent?.includes('${safeString}'));\n    if (el) (el as HTMLElement).click();\n  });\n`;
          } else {
            code += `  await page.evaluate(() => {\n    const el = Array.from(document.querySelectorAll('*')).find(e => e.textContent?.includes('${safeString}'));\n    if (el) (el as HTMLElement).click();\n  });\n`;
          }
          break;
        case 'type':
          code += `  await page.evaluate(() => {\n    const el = Array.from(document.querySelectorAll('*')).find(e => e.textContent?.includes('${safeString}'));\n    if (el) (el as HTMLElement).focus();\n  });\n`;
          code += `  await page.keyboard.type('${(action.value || '').replace(/'/g, "\\'")}');\n`;
          break;
        case 'press':
          code += `  await page.keyboard.press('${(action.value || action.target.value || 'Enter').replace(/'/g, "\\'")}');\n`;
          break;
        case 'hover':
          code += `  // Note: Hovering requires exact coordinates or a specific selector in Puppeteer\n`;
          break;
        case 'scroll':
          code += `  await page.evaluate(() => window.scrollBy(0, 500));\n`;
          break;
        case 'wait':
          code += `  await new Promise(r => setTimeout(r, 2000));\n`;
          break;
      }
      code += `\n`;
    });

    code += `  // await browser.close();\n})();`;
    return code;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-300 font-sans selection:bg-blue-500/30 selection:text-blue-200">
      <header className="bg-[#141414] border-b border-white/10 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.5)]">
              <Terminal className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">OmniPilot <span className="text-blue-500">Pro</span></h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs font-mono text-slate-500 uppercase tracking-widest hidden sm:block">
              Visual UI Agent
            </div>
            <button
              onClick={handleReset}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors"
              title="Reset all contents"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset
            </button>
            {/* @ts-ignore - aistudio is injected by the platform */}
            {typeof window !== 'undefined' && window.aistudio && (
              <button
                onClick={async () => {
                  try {
                    // @ts-ignore
                    await window.aistudio.openSelectKey();
                    // Optionally force a reload or state update if needed
                  } catch (e) {
                    console.error("Failed to open API key dialog", e);
                  }
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-md transition-colors"
                title="Set your own Gemini API Key to increase rate limits"
              >
                <Key className="w-3.5 h-3.5" />
                Set API Key
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Input */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#141414] rounded-2xl border border-white/10 p-6 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-white uppercase tracking-wider whitespace-nowrap">
                  <ImageIcon className="w-4 h-4 text-blue-500" />
                  1. Visual Context
                </h2>
                
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center bg-black/50 border border-white/10 rounded-md overflow-hidden">
                    <Globe className="w-3.5 h-3.5 text-slate-400 ml-2 flex-shrink-0" />
                    <input 
                      type="text" 
                      value={targetUrl}
                      onChange={(e) => setTargetUrl(e.target.value)}
                      className="bg-transparent text-xs text-white px-2 py-1.5 outline-none w-32 focus:w-48 transition-all"
                      placeholder="https://..."
                    />
                    <button
                      onClick={() => fetchWebsiteScreenshot(targetUrl)}
                      disabled={isFetchingWebsite || !targetUrl}
                      className="px-2 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 text-white transition-colors flex-shrink-0"
                    >
                      Fetch
                    </button>
                  </div>
                  <button
                    onClick={isScreenSharing ? stopScreenShare : startScreenShare}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-2 border flex-shrink-0 ${isScreenSharing ? 'bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30' : 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20'}`}
                  >
                    <MonitorUp className="w-3 h-3" />
                    {isScreenSharing ? 'Stop Sharing' : 'Share Screen'}
                  </button>
                </div>
              </div>
              
              <div className="relative">
                {/* Hidden video element for screen capture */}
                <video 
                  ref={videoRef} 
                  className={`w-full rounded-xl border border-white/10 bg-black ${isScreenSharing && !image ? 'block' : 'hidden'}`}
                  autoPlay 
                  playsInline 
                  muted 
                />

                {!image && !isScreenSharing ? (
                  isFetchingWebsite ? (
                    <div className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center flex flex-col items-center justify-center h-48">
                      <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                      <p className="text-sm font-medium text-slate-300">Fetching website screenshot...</p>
                    </div>
                  ) : (
                    <div 
                      className="border-2 border-dashed border-white/10 rounded-xl p-8 text-center hover:bg-white/5 hover:border-blue-500/50 transition-colors cursor-pointer group"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                        <UploadCloud className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-medium text-slate-300 mb-1">Upload Interface Screenshot</p>
                      <p className="text-xs text-slate-500">PNG, JPG up to 10MB</p>
                      <input 
                        type="file" 
                        className="hidden" 
                        ref={fileInputRef} 
                        accept="image/png, image/jpeg, image/webp" 
                        onChange={handleImageUpload}
                      />
                    </div>
                  )
                ) : image ? (
                  <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black group">
                    <img src={image.url} alt="Uploaded UI" className="w-full h-auto object-contain block" />
                    
                    {/* Render Action Coordinates */}
                    {actions?.map((action, idx) => {
                      if (!action.coordinates) return null;
                      const [y, x] = action.coordinates;
                      const isHovered = hoveredStep === idx;
                      return (
                        <div 
                          key={idx}
                          className={`absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-all duration-300 ${isHovered ? 'bg-blue-500 border-white text-white scale-125 z-10 shadow-[0_0_15px_rgba(37,99,235,0.8)]' : 'bg-blue-500/50 border-blue-400 text-white'}`}
                          style={{ top: `${(y / 1000) * 100}%`, left: `${(x / 1000) * 100}%` }}
                        >
                          {idx + 1}
                        </div>
                      );
                    })}

                    <button 
                      onClick={clearImage}
                      className="absolute top-3 right-3 w-8 h-8 bg-black/80 hover:bg-red-500/80 text-white rounded-full flex items-center justify-center backdrop-blur-sm transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="bg-[#141414] rounded-2xl border border-white/10 p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-white uppercase tracking-wider">
                  <Terminal className="w-4 h-4 text-emerald-500" />
                  2. Agent Command
                </h2>
                
                <button
                  onClick={toggleVoiceCommand}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-2 border ${isListening ? 'bg-red-500/20 text-red-400 border-red-500/30 animate-pulse' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'}`}
                >
                  {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                  {isListening ? 'Listening...' : 'Voice Command'}
                </button>
              </div>
              <textarea
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g., 'Add two of these to my cart' or 'Send a message to John'"
                className="w-full h-32 p-4 rounded-xl border border-white/10 bg-black/50 text-white focus:bg-black focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none text-sm font-mono"
              />
              
              <button
                onClick={handleGenerate}
                disabled={(!image && !isScreenSharing) || !command.trim() || isGenerating}
                className="mt-4 w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-white/5 disabled:text-slate-600 text-white font-medium rounded-xl flex items-center justify-center gap-2 transition-colors shadow-[0_0_15px_rgba(37,99,235,0.2)] disabled:shadow-none"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analyzing UI & Generating Actions...
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5" />
                    Execute Command
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Right Column: Output */}
          <div className="lg:col-span-7 bg-[#141414] rounded-2xl border border-white/10 p-6 shadow-xl flex flex-col h-full min-h-[600px]">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-white uppercase tracking-wider">
                <MousePointerClick className="w-4 h-4 text-purple-500" />
                Execution Plan
              </h2>
              
              {actions && actions.length > 0 && (
                <div className="flex bg-black/50 rounded-lg p-1 border border-white/10">
                  <button
                    onClick={() => setActiveTab('actions')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${activeTab === 'actions' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Steps
                  </button>
                  <button
                    onClick={() => setActiveTab('code')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${activeTab === 'code' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <Code className="w-3 h-3" /> Puppeteer
                  </button>
                  <button
                    onClick={() => setActiveTab('execution')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1 ${activeTab === 'execution' ? 'bg-blue-500/20 text-blue-400' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    <Globe className="w-3 h-3" /> Execute
                  </button>
                </div>
              )}
            </div>
            
            <div className="flex-1 bg-black/40 rounded-xl border border-white/5 p-4 overflow-auto relative">
              {!image && !command && !actions && !error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 space-y-4">
                  <div className="w-16 h-16 rounded-full border border-white/10 flex items-center justify-center bg-white/5">
                    <Terminal className="w-8 h-8 opacity-50" />
                  </div>
                  <p className="text-sm font-mono">Awaiting visual input and command...</p>
                </div>
              )}

              {error && (
                <div className="p-4 bg-red-500/10 text-red-400 rounded-lg text-sm border border-red-500/20 font-mono mb-4">
                  &gt; Error: {error}
                </div>
              )}

              {actions && actions.length === 0 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 space-y-3">
                  <p className="text-sm font-mono">No actions generated. Try a different command.</p>
                </div>
              )}

              {actions && actions.length > 0 && activeTab === 'actions' && (
                <div className="space-y-3">
                  {actions.map((action, index) => (
                    <div 
                      key={index} 
                      className="bg-[#1a1a1a] border border-white/5 hover:border-blue-500/30 rounded-lg p-4 transition-all duration-200 group"
                      onMouseEnter={() => setHoveredStep(index)}
                      onMouseLeave={() => setHoveredStep(null)}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 border transition-colors ${hoveredStep === index ? 'bg-blue-500/20 border-blue-500/50' : 'bg-white/5 border-white/10'}`}>
                          {getActionIcon(action.action)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">STEP {index + 1}</span>
                            <span className="text-sm font-semibold text-white capitalize">{action.action}</span>
                          </div>
                          
                          <div className="text-sm text-slate-300 mt-2">
                            Target: <span className="font-medium text-white">"{action.target.value}"</span> 
                            <span className="text-[10px] uppercase font-mono text-slate-500 ml-2">
                              [{action.target.type}]
                            </span>
                          </div>

                          {action.value && (
                            <div className="mt-2 text-xs text-emerald-400 bg-emerald-400/10 p-2 rounded border border-emerald-400/20 font-mono flex items-center gap-2">
                              <Keyboard className="w-3 h-3" />
                              Input: "{action.value}"
                            </div>
                          )}

                          {action.reasoning && (
                            <div className="mt-3 text-xs text-slate-400 border-l-2 border-white/10 pl-3 italic">
                              {action.reasoning}
                            </div>
                          )}
                          
                          {action.coordinates && (
                            <div className="mt-2 text-[10px] font-mono text-slate-500 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-blue-500" />
                              Spatial coordinates mapped: [Y: {action.coordinates[0]}, X: {action.coordinates[1]}]
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {actions && actions.length > 0 && activeTab === 'code' && (
                <div className="h-full">
                  <pre className="text-xs font-mono text-emerald-400 bg-black p-4 rounded-lg overflow-x-auto border border-white/10 h-full">
                    {generatePuppeteerCode(actions)}
                  </pre>
                </div>
              )}

              {actions && actions.length > 0 && activeTab === 'execution' && (
                <div className="h-full flex flex-col">
                  <div className="mb-4 flex gap-2">
                    <input 
                      type="url" 
                      value={targetUrl}
                      onChange={(e) => setTargetUrl(e.target.value)}
                      placeholder="https://example.com"
                      className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={handleExecutePuppeteer}
                      disabled={isExecuting}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
                    >
                      {isExecuting ? (
                        <><Loader2 className="w-4 h-4 animate-spin" /> Executing...</>
                      ) : (
                        <><Play className="w-4 h-4" /> Run in Puppeteer</>
                      )}
                    </button>
                  </div>

                  {executionResult && (
                    <div className="flex-1 overflow-auto space-y-4">
                      <div className="bg-black/50 border border-white/10 rounded-lg p-4">
                        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Execution Log</h3>
                        <div className="space-y-1 font-mono text-xs">
                          {executionResult.log.map((logLine: string, i: number) => (
                            <div key={i} className="text-emerald-400">
                              <span className="text-slate-500 mr-2">[{i+1}]</span>
                              {logLine}
                            </div>
                          ))}
                        </div>
                      </div>
                      
                      {executionResult.finalScreenshot && (
                        <div className="bg-black/50 border border-white/10 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                              {isExecuting ? <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> Live View</> : "Final State"}
                              {isInteractiveMode && !isExecuting && <span className="text-blue-400 ml-2">(Interactive Mode Active)</span>}
                            </h3>
                            {isInteractiveMode && !isExecuting && (
                              <button 
                                onClick={handleCloseSession}
                                className="text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 px-2 py-1 rounded"
                              >
                                Close Session
                              </button>
                            )}
                          </div>
                          
                          <div className="relative group">
                            <img 
                              src={executionResult.finalScreenshot} 
                              alt="Browser state" 
                              className={`w-full rounded border border-white/10 ${isInteractiveMode ? 'cursor-crosshair' : ''}`}
                              onClick={isInteractiveMode ? handleInteractiveClick : undefined}
                            />
                            {isInteractiveMode && (
                              <div className="absolute bottom-4 left-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <input 
                                  type="text" 
                                  value={interactiveInput}
                                  onChange={(e) => setInteractiveInput(e.target.value)}
                                  onKeyDown={handleInteractiveType}
                                  placeholder="Type text and press Enter..."
                                  className="flex-1 bg-black/80 backdrop-blur border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
