"use client";

import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Html5Qrcode } from "html5-qrcode";
import { useAuth } from "./contexts/AuthContext";
import { saveAnalysisToFirestore } from "./lib/firestore-history";
import {
  getAnonCreditsRemaining, consumeAnonCredit, consumeUserCredits, addUserCredits, getUserCredits,
  claimShareCredit, claimRewardedAdCredit, canShareForCredit, getSharesToday,
  CREDIT_COST_TEXT, CREDIT_COST_MEDIA, REWARDED_AD_CREDITS,
  SHARE_REWARD, SHARE_DAILY_MAX, SIGNUP_BONUS, ANON_DAILY_LIMIT,
} from "./lib/credits";

// Use local API routes (which proxy to backend) for HTTPS compatibility
const API_URL = "/api";

// Fallback UUID generator for non-secure contexts (HTTP)
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for HTTP contexts
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ===========================
   Error Boundary
=========================== */

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Error caught by boundary:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0a0a12] flex items-center justify-center p-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-6 max-w-md w-full">
            <h2 className="text-red-400 text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-white/60 text-sm mb-4">Error details:</p>
            <pre className="text-xs text-red-300 bg-black/30 p-3 rounded-lg overflow-auto max-h-40 mb-4">
              {this.state.error?.message}
              {"\n\n"}
              {this.state.error?.stack}
            </pre>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="w-full py-3 bg-white/10 hover:bg-white/15 text-white rounded-xl transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/* ===========================
   Types
=========================== */

interface HistoryItem {
  id: string;
  timestamp: number;
  inputType: "text" | "audio" | "image" | "barcode";
  inputSummary: string;
  grade: string;
  result: any;
}

/* ===========================
   History Storage Functions
=========================== */

const HISTORY_KEY = "know-your-food-history";
const MAX_HISTORY_ITEMS = 50;

function getHistory(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveToHistory(item: Omit<HistoryItem, "id" | "timestamp">): HistoryItem {
  const newItem: HistoryItem = {
    ...item,
    id: generateUUID(),
    timestamp: Date.now(),
  };
  
  try {
    const history = getHistory();
    const updated = [newItem, ...history].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    console.warn("Could not save to history");
  }
  return newItem;
}

function deleteFromHistory(id: string): void {
  try {
    const history = getHistory();
    const updated = history.filter((item) => item.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
  } catch {
    console.warn("Could not delete from history");
  }
}

function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    console.warn("Could not clear history");
  }
}

/* ===========================
   Fallacy Labels
=========================== */

const FALLACY_LABELS: Record<string, string> = {
  correlation_causation: "Correlation ≠ Causation",
  anecdotal: "Anecdotal Evidence",
  appeal_to_nature: "Appeal to Nature",
  appeal_to_antiquity: "Appeal to Antiquity",
  cherry_picking: "Cherry-Picking",
  false_dichotomy: "False Dichotomy",
  appeal_to_authority: "Misused Authority",
  post_hoc: "Post Hoc Fallacy",
  fear_mongering: "Fear Mongering",
};

/* ===========================
   Background Component
=========================== */

function AnimatedBackground() {
  return (
    <div className="gradient-bg">
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <div className="orb orb-4" />
    </div>
  );
}

/* ===========================
   History Panel Component
=========================== */

function HistoryPanel({ 
  isOpen, 
  onClose, 
  history, 
  onSelect, 
  onDelete, 
  onClear 
}: { 
  isOpen: boolean;
  onClose: () => void;
  history: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  if (!isOpen) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getInputIcon = (type: string) => {
    switch (type) {
      case "audio": return "🎤";
      case "image": return "📷";
      case "barcode": return "📊";
      default: return "💬";
    }
  };

  const getGradeColor = (grade: string) => {
    if (grade.includes("A") || grade === "Accurate") return "text-green-400";
    if (grade.includes("B") || grade === "Almost") return "text-blue-400";
    if (grade.includes("C") || grade === "Misleading") return "text-red-400";
    return "text-white/50";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Panel */}
      <div className="relative w-full max-w-md h-full bg-[#0a0a0f]/95 backdrop-blur-xl border-l border-white/10 animate-slide-in-left overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-5 border-b border-white/10 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">History</h2>
            <p className="text-xs text-white/40">{history.length} analyses saved</p>
          </div>
          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <button
                onClick={onClear}
                className="text-xs text-red-400/70 hover:text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                Clear All
              </button>
            )}
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        
        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {history.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
                <svg className="w-8 h-8 text-white/20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-white/40 text-sm">No analyses yet</p>
              <p className="text-white/25 text-xs mt-1">Your history will appear here</p>
            </div>
          ) : (
            history.map((item) => (
              <div
                key={item.id}
                className="group section-glass rounded-xl p-4 cursor-pointer hover:bg-white/[0.08] transition-all"
                onClick={() => onSelect(item)}
              >
                <div className="flex items-start gap-3">
                  <span className="text-lg">{getInputIcon(item.inputType)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80 line-clamp-2 mb-1">
                      {item.inputSummary}
                    </p>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={`font-medium ${getGradeColor(item.grade)}`}>
                        {item.grade}
                      </span>
                      <span className="text-white/30">•</span>
                      <span className="text-white/30">{formatDate(item.timestamp)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 w-7 h-7 rounded-lg hover:bg-red-500/20 flex items-center justify-center transition-all"
                  >
                    <svg className="w-3.5 h-3.5 text-red-400/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ===========================
   Barcode Scanner Component
=========================== */

function BarcodeScanner({ 
  isOpen, 
  onClose, 
  onScan 
}: { 
  isOpen: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}) {
  const [error, setError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanMode, setScanMode] = useState<"camera" | "upload" | "manual">("camera");
  const [processing, setProcessing] = useState(false);
  const [manualBarcode, setManualBarcode] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && scanMode === "camera" && !scanning) {
      startScanner();
    }
    
    return () => {
      stopScanner();
    };
  }, [isOpen, scanMode]);

  const startScanner = async () => {
    try {
      setError("");
      setScanning(true);
      
      const scanner = new Html5Qrcode("barcode-reader");
      scannerRef.current = scanner;
      
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 150 },
        },
        (decodedText) => {
          onScan(decodedText);
          stopScanner();
          onClose();
        },
        () => {}
      );
    } catch (err: any) {
      setError("Camera access denied or not available. Try uploading an image instead.");
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current = null;
      } catch {}
    }
    setScanning(false);
  };

  const handleModeSwitch = async (mode: "camera" | "upload" | "manual") => {
    if (mode === scanMode) return;
    await stopScanner();
    setError("");
    setScanMode(mode);
  };

  const handleManualSubmit = () => {
    const trimmed = manualBarcode.trim();
    if (!trimmed) {
      setError("Please enter a barcode number");
      return;
    }
    if (!/^\d{8,14}$/.test(trimmed)) {
      setError("Invalid barcode. Please enter 8-14 digits (EAN-8, EAN-13, UPC-A, etc.)");
      return;
    }
    onScan(trimmed);
    setManualBarcode("");
    onClose();
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setError("");

    try {
      const scanner = new Html5Qrcode("barcode-image-reader", {
        verbose: false,
        formatsToSupport: [
          0,  // QR_CODE
          1,  // AZTEC
          2,  // CODABAR
          3,  // CODE_39
          4,  // CODE_93
          5,  // CODE_128
          6,  // DATA_MATRIX
          7,  // MAXICODE
          8,  // ITF
          9,  // EAN_13
          10, // EAN_8
          11, // PDF_417
          12, // RSS_14
          13, // RSS_EXPANDED
          14, // UPC_A
          15, // UPC_E
          16, // UPC_EAN_EXTENSION
        ]
      });
      
      const result = await scanner.scanFile(file, /* showImage */ true);
      await scanner.clear();
      onScan(result);
      onClose();
    } catch (err: any) {
      // This is expected when no barcode is found - not a crash
      console.log("Barcode not detected in image");
      setError("BARCODE_NOT_FOUND");
    } finally {
      setProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleClose = () => {
    stopScanner();
    setScanMode("camera");
    setManualBarcode("");
    setError("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-sm glass-vibrant rounded-2xl overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Scan Barcode</h2>
            <p className="text-xs text-white/40">
              {scanMode === "camera" && "Point camera at product barcode"}
              {scanMode === "upload" && "Upload barcode image"}
              {scanMode === "manual" && "Enter barcode number manually"}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center"
          >
            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="px-4 pt-4">
          <div className="flex gap-1 p-1 bg-white/5 rounded-xl">
            <button
              onClick={() => handleModeSwitch("camera")}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                scanMode === "camera"
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Camera
            </button>
            <button
              onClick={() => handleModeSwitch("upload")}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                scanMode === "upload"
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Upload
            </button>
            <button
              onClick={() => handleModeSwitch("manual")}
              className={`flex-1 py-2 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
                scanMode === "manual"
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white/70"
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
              Manual
            </button>
          </div>
        </div>
        
        {/* Scanner / Upload / Manual Area */}
        <div className="p-4">
          {/* Hidden scanner element for image processing (always present) */}
          <div id="barcode-image-reader" style={{ display: "none" }} />
          
          {scanMode === "camera" && (
            <div 
              id="barcode-reader" 
              className="w-full rounded-xl overflow-hidden bg-black/50"
              style={{ minHeight: "250px" }}
            />
          )}
          
          {scanMode === "upload" && (
            <div className="space-y-4">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                id="barcode-image-input"
              />
              
              {/* Upload area */}
              <label
                htmlFor="barcode-image-input"
                className={`flex flex-col items-center justify-center w-full h-48 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                  processing
                    ? "border-white/20 bg-white/5"
                    : "border-white/20 hover:border-white/40 hover:bg-white/5"
                }`}
              >
                {processing ? (
                  <>
                    <div className="w-10 h-10 border-2 border-white/20 border-t-white/60 rounded-full animate-spin mb-3" />
                    <p className="text-sm text-white/60">Processing image...</p>
                  </>
                ) : (
                  <>
                    <svg className="w-12 h-12 text-white/30 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-sm text-white/60 mb-1">Click to upload barcode image</p>
                    <p className="text-xs text-white/30">PNG, JPG, or WEBP</p>
                  </>
                )}
              </label>
            </div>
          )}

          {scanMode === "manual" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-6">
                <svg className="w-16 h-16 text-white/20 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                <p className="text-sm text-white/50 mb-4 text-center">
                  Enter the barcode number printed below the barcode
                </p>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g., 8901234567890"
                  value={manualBarcode}
                  onChange={(e) => setManualBarcode(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-center text-lg tracking-widest placeholder:text-white/20 focus:outline-none focus:border-white/30 transition-colors"
                  maxLength={14}
                />
                <button
                  onClick={handleManualSubmit}
                  disabled={!manualBarcode.trim()}
                  className="mt-4 w-full py-3 bg-white/10 hover:bg-white/15 disabled:bg-white/5 disabled:text-white/30 text-white rounded-xl transition-colors font-medium"
                >
                  Look Up Product
                </button>
              </div>
            </div>
          )}
          
          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              {error === "BARCODE_NOT_FOUND" ? (
                <div className="text-center">
                  <p className="text-red-400 text-sm mb-3">
                    Couldn't detect barcode in image
                  </p>
                  <p className="text-white/50 text-xs mb-3">
                    Try a clearer image, or enter the number manually
                  </p>
                  <button
                    onClick={() => {
                      setError("");
                      setScanMode("manual");
                    }}
                    className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-sm rounded-lg transition-colors"
                  >
                    Enter Barcode Manually
                  </button>
                </div>
              ) : (
                <p className="text-red-400 text-sm text-center">{error}</p>
              )}
            </div>
          )}
          
          <p className="text-center text-xs text-white/30 mt-4">
            Supports UPC, EAN, and other product barcodes
          </p>
        </div>
      </div>
    </div>
  );
}

/* ===========================
   Social Share Component
=========================== */

function SocialShareMenu({ 
  isOpen, 
  onClose, 
  shareText 
}: { 
  isOpen: boolean;
  onClose: () => void;
  shareText: string;
}) {
  if (!isOpen) return null;

  const shareUrl = typeof window !== "undefined" ? window.location.href : "";
  
  const shareOptions = [
    {
      name: "WhatsApp",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
      ),
      color: "bg-[#25D366]/20 text-[#25D366] hover:bg-[#25D366]/30",
      action: () => {
        window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank");
      },
    },
    {
      name: "Twitter",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      ),
      color: "bg-white/10 text-white hover:bg-white/20",
      action: () => {
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText.slice(0, 280))}`, "_blank");
      },
    },
    {
      name: "Instagram",
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
        </svg>
      ),
      color: "bg-[#E4405F]/20 text-[#E4405F] hover:bg-[#E4405F]/30",
      action: async () => {
        await navigator.clipboard.writeText(shareText);
        window.open("https://www.instagram.com/", "_blank");
      },
    },
    {
      name: "Copy Content",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      ),
      color: "bg-white/10 text-white hover:bg-white/20",
      action: async () => {
        await navigator.clipboard.writeText(shareText);
        onClose();
      },
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90"
        onClick={onClose}
      />
      
      {/* Menu */}
      <div className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 glass-vibrant rounded-2xl overflow-hidden animate-slide-up">
        <div className="p-4 border-b border-white/10">
          <h3 className="text-lg font-semibold text-white text-center">Share Analysis</h3>
        </div>
        
        <div className="p-4 grid grid-cols-3 gap-3">
          {shareOptions.map((option) => (
            <button
              key={option.name}
              onClick={option.action}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl transition-all ${option.color}`}
            >
              {option.icon}
              <span className="text-xs font-medium">{option.name}</span>
            </button>
          ))}
        </div>
        
        <div className="p-4 pt-0">
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-white/5 text-white/60 text-sm font-medium hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===========================
   Feedback Modal Component
=========================== */

function FeedbackModal({ 
  isOpen, 
  onClose,
  grade,
}: { 
  isOpen: boolean;
  onClose: () => void;
  grade?: string;
}) {
  const [feedbackType, setFeedbackType] = useState<"incorrect" | "incomplete" | "other" | null>(null);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    // In a real app, you'd send this to your backend
    console.log("Feedback submitted:", { feedbackType, comment, grade });
    setSubmitted(true);
    setTimeout(() => {
      onClose();
      setSubmitted(false);
      setFeedbackType(null);
      setComment("");
    }, 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/90"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative w-full max-w-md glass-vibrant rounded-2xl overflow-hidden animate-scale-in">
        {submitted ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-2">Thank You!</h3>
            <p className="text-white/50 text-sm">Your feedback helps us improve.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">Report Issue</h2>
                <p className="text-xs text-white/40">Help us improve our analysis</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center"
              >
                <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            {/* Content */}
            <div className="p-5">
              <p className="text-sm text-white/60 mb-4">What was wrong with this analysis?</p>
              
              <div className="space-y-2 mb-5">
                {[
                  { id: "incorrect", label: "Grade is incorrect", desc: "The accuracy rating doesn't match the evidence" },
                  { id: "incomplete", label: "Missing information", desc: "Important context or facts were left out" },
                  { id: "other", label: "Other issue", desc: "Something else was wrong" },
                ].map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setFeedbackType(option.id as any)}
                    className={`w-full p-4 rounded-xl text-left transition-all ${
                      feedbackType === option.id 
                        ? "bg-blue-500/20 border border-blue-500/40" 
                        : "bg-white/5 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    <p className={`text-sm font-medium ${feedbackType === option.id ? "text-blue-300" : "text-white/80"}`}>
                      {option.label}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">{option.desc}</p>
                  </button>
                ))}
              </div>
              
              {feedbackType && (
                <div className="animate-fade-in">
                  <textarea
                    placeholder="Tell us more (optional)..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="w-full h-24 p-4 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 resize-none focus:outline-none focus:border-white/20"
                  />
                </div>
              )}
            </div>
            
            {/* Footer */}
            <div className="p-5 pt-0 flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-white/5 text-white/60 text-sm font-medium hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!feedbackType}
                className="flex-1 py-3 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Feedback
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ===========================
   Ad Banner Component
=========================== */

function AdBanner({ visible }: { visible: boolean }) {
  const adClient = process.env.NEXT_PUBLIC_ADSENSE_ID;
  const adSlot = process.env.NEXT_PUBLIC_AD_SLOT_LOADING;
  const isReal = !!(adClient && adSlot);
  const adRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (isReal && adRef.current && !pushed.current) {
      try {
        ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
        pushed.current = true;
      } catch {}
    }
  }, [isReal]);

  if (!visible) return null;

  if (isReal) {
    return (
      <div className="animate-fade-in">
        <p className="text-[10px] font-medium text-white/20 uppercase tracking-widest mb-2 text-center">
          Sponsored
        </p>
        <div className="flex justify-center overflow-hidden rounded-xl">
          <ins
            ref={adRef}
            className="adsbygoogle"
            style={{ display: "block", width: "100%", maxHeight: "100px" }}
            data-ad-client={adClient}
            data-ad-slot={adSlot}
            data-ad-format="horizontal"
            data-full-width-responsive="true"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <p className="text-[10px] font-medium text-white/20 uppercase tracking-widest mb-2 text-center">
        Sponsored
      </p>
      <div className="section-glass rounded-xl p-4 flex items-center justify-center" style={{ minHeight: "80px" }}>
        <div className="text-center">
          <p className="text-xs text-white/25 mb-1">Ad space available</p>
          <p className="text-[10px] text-white/15">Set NEXT_PUBLIC_ADSENSE_ID to enable</p>
        </div>
      </div>
    </div>
  );
}

/* ===========================
   Loading Component
=========================== */

function LoadingState({ onCancel, isUrl = false }: { onCancel?: () => void; isUrl?: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [currentFact, setCurrentFact] = useState(0);
  const [factVisible, setFactVisible] = useState(true);
  const [showAd, setShowAd] = useState(false);

  const stages = [
    { icon: "🔍", label: "Understanding your input", threshold: 0 },
    { icon: "🧬", label: "Extracting claims", threshold: 8 },
    { icon: "📚", label: "Searching scientific databases", threshold: 18 },
    { icon: "⚖️", label: "Cross-referencing evidence", threshold: 35 },
    { icon: "🧪", label: "Analyzing claim accuracy", threshold: 55 },
    { icon: "📝", label: "Preparing your report", threshold: 75 },
  ];

  const urlStages = [
    { icon: "🔍", label: "Extracting health claims", threshold: 0 },
    { icon: "📚", label: "Searching scientific databases", threshold: 25 },
    { icon: "⚖️", label: "Analyzing evidence", threshold: 55 },
    { icon: "📝", label: "Preparing your report", threshold: 85 },
  ];

  const activeStages = isUrl ? urlStages : stages;

  const facts = [
    "Your body replaces its entire skeleton roughly every 10 years.",
    "The human nose can detect over 1 trillion different scents.",
    "Honey never spoils — archaeologists found 3000-year-old edible honey in Egyptian tombs.",
    "Bananas are naturally radioactive due to potassium-40, but completely safe.",
    "Your stomach acid is strong enough to dissolve metal, yet your stomach lining regenerates every few days.",
    "Almonds are members of the peach family.",
    "Apples float in water because they're 25% air.",
    "The average person eats about 35 tons of food in a lifetime.",
    "Dark chocolate contains more antioxidants per gram than blueberries.",
    "Carrots were originally purple — the orange variety was bred in the Netherlands.",
    "Coconut water can be used as an emergency IV fluid substitute.",
    "A single strand of spaghetti is called a spaghetto.",
    "Peanuts are not nuts — they're legumes that grow underground.",
    "Capsaicin in chili peppers triggers the same brain receptors as physical heat.",
    "Your gut microbiome contains about 2 kg of bacteria — roughly 100 trillion organisms.",
    "Caffeine takes about 20 minutes to start working and peaks at 45 minutes.",
  ];

  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setFactVisible(false);
      setTimeout(() => {
        setCurrentFact(f => (f + 1) % facts.length);
        setFactVisible(true);
      }, 400);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (elapsed < 10) { setShowAd(false); return; }
    const sinceStart = elapsed - 10;
    const cyclePosition = sinceStart % 25; // 15s ad + 10s fact = 25s cycle
    setShowAd(cyclePosition < 15);
  }, [elapsed]);

  const currentStageIdx = activeStages.reduce((acc, stage, i) => 
    elapsed >= stage.threshold ? i : acc, 0
  );
  const stage = activeStages[currentStageIdx];

  const progress = Math.min(
    ((elapsed - stage.threshold) / 
    ((activeStages[currentStageIdx + 1]?.threshold || (isUrl ? 140 : 90)) - stage.threshold)) * 100,
    100
  );

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  return (
    <div className="mt-6 sm:mt-10 animate-fade-in">
      <div className="glass-vibrant rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="p-6 sm:p-8 md:p-10">

          {/* Animated DNA helix / pulse */}
          <div className="flex justify-center mb-6">
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full border-2 border-white/10" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-white/80 border-r-white/30 animate-[spin_1.2s_cubic-bezier(0.5,0,0.5,1)_infinite]" />
              <div className="absolute inset-2 rounded-full border-2 border-transparent border-b-blue-400/60 border-l-blue-400/20 animate-[spin_1.8s_cubic-bezier(0.5,0,0.5,1)_infinite_reverse]" />
              <div className="absolute inset-0 flex items-center justify-center text-2xl animate-[pulse_2s_ease-in-out_infinite]">
                {stage.icon}
              </div>
            </div>
          </div>

          {/* Current stage */}
          <div className="text-center mb-6">
            <p className="text-base sm:text-lg font-semibold text-white mb-1 transition-all duration-300">
              {stage.label}
            </p>
            <p className="text-xs sm:text-sm text-white/40">
              {formatTime(elapsed)} elapsed
            </p>
          </div>

          {/* Stage progress bar */}
          <div className="mb-6 px-2">
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all duration-1000 ease-out"
                style={{ 
                  width: `${((currentStageIdx + progress / 100) / activeStages.length) * 100}%`,
                  background: "linear-gradient(90deg, rgba(99,102,241,0.8), rgba(59,130,246,0.8), rgba(34,197,94,0.6))"
                }}
              />
            </div>
          </div>

          {/* Stage checklist */}
          <div className="grid gap-2.5 mb-8">
            {activeStages.map((s, i) => {
              const isDone = i < currentStageIdx;
              const isActive = i === currentStageIdx;
              return (
                <div 
                  key={i}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-500 ${
                    isActive 
                      ? "bg-white/[0.08] border border-white/15" 
                      : isDone 
                        ? "bg-white/[0.03] opacity-60" 
                        : "opacity-30"
                  }`}
                >
                  <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                    {isDone ? (
                      <svg className="w-5 h-5 text-green-400 animate-scale-in" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isActive ? (
                      <div className="w-4 h-4 rounded-full border-2 border-blue-400/80 border-t-transparent animate-[spin_0.8s_linear_infinite]" />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-white/20" />
                    )}
                  </div>
                  <span className={`text-sm ${isActive ? "text-white/90 font-medium" : isDone ? "text-white/50" : "text-white/30"}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Did you know / Ad section */}
          <div className="mb-6" style={{ minHeight: "80px" }}>
            {showAd ? (
              <AdBanner visible={showAd} />
            ) : (
              <div className="section-glass rounded-xl p-4 animate-fade-in" style={{ minHeight: "80px" }}>
                <p className="text-[10px] font-medium text-white/30 uppercase tracking-widest mb-2">
                  Did you know?
                </p>
                <p className={`text-sm text-white/60 leading-relaxed transition-all duration-300 ${factVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>
                  {facts[currentFact]}
                </p>
              </div>
            )}
          </div>

          {/* Cancel button */}
          {onCancel && (
            <div className="flex justify-center">
              <button
                onClick={onCancel}
                className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/50 text-sm font-medium tap-highlight flex items-center gap-2 touch-target hover:bg-white/10 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ===========================
   Not Relevant Card Component
=========================== */

function NotRelevantCard({ reason, onTryAgain }: { reason?: string; onTryAgain?: () => void }) {
  const examples = [
    { icon: "💬", text: "\"Eating bananas at night causes weight gain\"" },
    { icon: "💪", text: "\"Morning workouts burn more fat than evening\"" },
    { icon: "🔗", text: "Paste a health/fitness reel or shorts link" },
    { icon: "📷", text: "Upload a food label or health product image" },
  ];

  return (
    <div className="mt-6 sm:mt-10 animate-slide-from-bottom">
      <div className="glass-vibrant rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="p-5 sm:p-6 md:p-8">
          
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8">
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-2xl bg-blue-500/[0.08] border border-blue-400/15 flex items-center justify-center">
              <svg className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
              Try a Health Claim
            </h2>
            <p className="text-sm sm:text-base text-white/50 max-w-md mx-auto">
              {reason || "We couldn't find a health or nutrition claim to analyze. Try one of the examples below!"}
            </p>
          </div>

          <div className="divider" />

          {/* What we analyze */}
          <div className="mb-6">
            <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-4 text-center">
              What You Can Analyze
            </p>
            <div className="grid gap-3 stagger-fast">
              {examples.map((example, i) => (
                <div 
                  key={i}
                  className="section-glass rounded-xl p-4 flex items-center gap-4 tap-highlight"
                  style={{ animationDelay: `${0.2 + i * 0.08}s` }}
                >
                  <span className="text-2xl animate-float" style={{ animationDelay: `${i * 0.3}s` }}>{example.icon}</span>
                  <p className="text-sm text-white/70">{example.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="section-glass section-blue rounded-xl p-4 sm:p-5 mb-6">
            <p className="text-xs sm:text-sm font-medium text-blue-300 mb-2">
              Tips for best results
            </p>
            <ul className="space-y-2 text-xs sm:text-sm text-white/60">
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">•</span>
                <span>Enter specific health or fitness claims</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">•</span>
                <span>Paste links to reels/shorts about health, diet, or exercise</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-400 mt-0.5">•</span>
                <span>Upload clear images of food labels or health product claims</span>
              </li>
            </ul>
          </div>

          {/* Try Again Button */}
          {onTryAgain && (
            <button
              onClick={onTryAgain}
              className="btn-glow w-full touch-target flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try Again
            </button>
          )}

        </div>
      </div>
    </div>
  );
}

/* ===========================
   Product Not Found Card
=========================== */

function ProductNotFoundCard({ 
  barcode, 
  onManualEntry, 
  onPhotoLabel,
  onClose 
}: { 
  barcode: string;
  onManualEntry: (productInfo: string) => void;
  onPhotoLabel: () => void;
  onClose: () => void;
}) {
  const [showManualForm, setShowManualForm] = useState(false);
  const [productName, setProductName] = useState("");
  const [brand, setBrand] = useState("");
  const [ingredients, setIngredients] = useState("");

  const handleManualSubmit = () => {
    if (!productName.trim()) return;
    
    const productInfo = [
      `Product: ${productName.trim()}`,
      brand.trim() ? `Brand: ${brand.trim()}` : "",
      ingredients.trim() ? `Ingredients: ${ingredients.trim()}` : "",
    ].filter(Boolean).join(". ");
    
    onManualEntry(productInfo);
  };

  return (
    <div className="mt-8 sm:mt-10 animate-fade-in-up">
      <div className="glass-vibrant rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="p-5 sm:p-6 md:p-8">
          
          {!showManualForm ? (
            <>
              {/* Header */}
              <div className="text-center mb-6 sm:mb-8">
                <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
                  <svg className="w-8 h-8 sm:w-10 sm:h-10 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                  Product Not Found
                </h2>
                <p className="text-sm sm:text-base text-white/50 max-w-md mx-auto mb-2">
                  This product (barcode: {barcode}) isn't in our database yet.
                </p>
                <p className="text-xs text-white/30">
                  Many Indian products are not yet catalogued in global databases.
                </p>
              </div>

              <div className="divider" />

              {/* Alternative Options */}
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-4 text-center">
                What You Can Do Instead
              </p>
              
              <div className="space-y-3 mb-6">
                {/* Option 1: Manual Entry */}
                <button
                  onClick={() => setShowManualForm(true)}
                  className="w-full section-glass rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.08] transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Enter Product Details Manually</p>
                    <p className="text-xs text-white/50">Type the product name and ingredients</p>
                  </div>
                  <svg className="w-5 h-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Option 2: Photo Label */}
                <button
                  onClick={onPhotoLabel}
                  className="w-full section-glass rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.08] transition-colors text-left"
                >
                  <div className="w-10 h-10 rounded-xl bg-green-500/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Photo the Product Label</p>
                    <p className="text-xs text-white/50">Upload an image of ingredients/nutrition facts</p>
                  </div>
                  <svg className="w-5 h-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Option 3: Contribute to Database */}
                <a
                  href={`https://world.openfoodfacts.org/cgi/product.pl?code=${barcode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full section-glass rounded-xl p-4 flex items-center gap-4 hover:bg-white/[0.08] transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Add to Open Food Facts</p>
                    <p className="text-xs text-white/50">Help others by adding this product to the database</p>
                  </div>
                  <svg className="w-5 h-5 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>

              {/* Scan Another */}
              <button
                onClick={onClose}
                className="btn-glass w-full touch-target flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                </svg>
                Scan Another Product
              </button>
            </>
          ) : (
            <>
              {/* Manual Entry Form */}
              <div className="mb-6">
                <button
                  onClick={() => setShowManualForm(false)}
                  className="flex items-center gap-2 text-sm text-white/50 hover:text-white/70 transition-colors mb-4"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back to options
                </button>
                
                <h2 className="text-xl sm:text-2xl font-semibold text-white mb-2">
                  Enter Product Details
                </h2>
                <p className="text-sm text-white/50 mb-6">
                  Enter what you know about the product. More details = better analysis.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-2">
                      Product Name *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Maggi 2-Minute Noodles"
                      value={productName}
                      onChange={(e) => setProductName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-2">
                      Brand (optional)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Nestlé"
                      value={brand}
                      onChange={(e) => setBrand(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-white/50 mb-2">
                      Ingredients (optional but recommended)
                    </label>
                    <textarea
                      placeholder="Copy from the product label, e.g., Wheat flour, palm oil, salt, sugar..."
                      value={ingredients}
                      onChange={(e) => setIngredients(e.target.value)}
                      rows={4}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 transition-colors resize-none"
                    />
                  </div>
                </div>
              </div>

              <button
                onClick={handleManualSubmit}
                disabled={!productName.trim()}
                className="btn-glow w-full touch-target flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Analyze Product
              </button>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

/* ===========================
   Result Card Component
=========================== */

interface ProductDetails {
  name: string;
  brand?: string;
  calories?: number;
  fat?: number;
  sugar?: number;
  protein?: number;
  novaGroup?: number;
}

function ResultCard({ 
  item, 
  inputType = "text", 
  transcript = null,
  nutriScore = null,
  productDetails = null
}: { 
  item: any; 
  inputType?: string; 
  transcript?: string | null;
  nutriScore?: string | null;
  productDetails?: ProductDetails | null;
}) {
  const [copied, setCopied] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const isBarcodeScan = inputType === "barcode";

  // Nutri-Score color mapping
  const getNutriScoreStyle = (score: string | null) => {
    if (!score) return null;
    const styles: Record<string, { bg: string; text: string; label: string }> = {
      'A': { bg: 'bg-green-600', text: 'text-white', label: 'Excellent' },
      'B': { bg: 'bg-lime-500', text: 'text-white', label: 'Good' },
      'C': { bg: 'bg-yellow-400', text: 'text-gray-900', label: 'Average' },
      'D': { bg: 'bg-orange-500', text: 'text-white', label: 'Poor' },
      'E': { bg: 'bg-red-600', text: 'text-white', label: 'Bad' },
    };
    return styles[score] || null;
  };

  const nutriScoreStyle = getNutriScoreStyle(nutriScore);

  // Generate product review summary for barcode scans
  const getProductReviewSummary = () => {
    if (!productDetails) return null;
    
    const parts: string[] = [];
    const productName = productDetails.brand 
      ? `${productDetails.name} by ${productDetails.brand}`
      : productDetails.name;
    
    parts.push(`This is ${productName}`);
    
    const nutritionFacts: string[] = [];
    if (productDetails.sugar !== undefined && productDetails.sugar > 10) {
      nutritionFacts.push(`high sugar content (${productDetails.sugar}g per 100g)`);
    } else if (productDetails.sugar !== undefined && productDetails.sugar > 5) {
      nutritionFacts.push(`moderate sugar content (${productDetails.sugar}g per 100g)`);
    } else if (productDetails.sugar !== undefined) {
      nutritionFacts.push(`low sugar (${productDetails.sugar}g per 100g)`);
    }
    
    if (productDetails.fat !== undefined && productDetails.fat > 17) {
      nutritionFacts.push(`high fat content (${productDetails.fat}g per 100g)`);
    } else if (productDetails.fat !== undefined && productDetails.fat > 3) {
      nutritionFacts.push(`moderate fat content (${productDetails.fat}g per 100g)`);
    } else if (productDetails.fat !== undefined) {
      nutritionFacts.push(`low fat (${productDetails.fat}g per 100g)`);
    }
    
    if (productDetails.calories !== undefined) {
      nutritionFacts.push(`${productDetails.calories} calories per 100g`);
    }
    
    if (productDetails.protein !== undefined && productDetails.protein > 10) {
      nutritionFacts.push(`good protein source (${productDetails.protein}g per 100g)`);
    }
    
    if (nutritionFacts.length > 0) {
      parts.push(`with ${nutritionFacts.join(', ')}`);
    }
    
    if (nutriScore) {
      const scoreLabels: Record<string, string> = {
        'A': 'excellent nutritional quality',
        'B': 'good nutritional quality', 
        'C': 'average nutritional quality',
        'D': 'poor nutritional quality',
        'E': 'low nutritional quality',
      };
      parts.push(`The Nutri-Score is ${nutriScore} (${scoreLabels[nutriScore] || 'unknown'})`);
    }
    
    if (productDetails.novaGroup) {
      const novaLabels: Record<number, string> = {
        1: 'unprocessed or minimally processed',
        2: 'processed culinary ingredients',
        3: 'processed foods',
        4: 'ultra-processed foods',
      };
      parts.push(`This is classified as NOVA Group ${productDetails.novaGroup} (${novaLabels[productDetails.novaGroup] || 'unknown processing level'})`);
    }
    
    return parts.join('. ') + '.';
  };

  if (!item) return null;

  const getTextToSpeak = () => {
    const textParts: string[] = [];

    if (item.overall_grade) {
      textParts.push(`Grade: ${item.overall_grade}.`);
    }

    if (item.bottom_line) {
      textParts.push(`Bottom line: ${item.bottom_line}`);
    }

    if (item.key_points?.length > 0) {
      textParts.push("Key points:");
      item.key_points.forEach((point: string, i: number) => {
        textParts.push(`${i + 1}. ${point}`);
      });
    }

    if (item.suggested_action) {
      textParts.push(`Recommended action: ${item.suggested_action}`);
    }

    return textParts.join(" ");
  };

  const isSpeechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  const handleSpeak = () => {
    if (!isSpeechSupported) return;
    
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    const fullText = getTextToSpeak();
    if (!fullText.trim()) return;

    const utterance = new SpeechSynthesisUtterance(fullText);
    utterance.rate = speechRate;
    utterance.pitch = 1;
    
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleSpeedChange = (newRate: number) => {
    setSpeechRate(newRate);
    if (isSpeaking && isSpeechSupported) {
      window.speechSynthesis.cancel();
      const fullText = getTextToSpeak();
      if (!fullText.trim()) return;

      const utterance = new SpeechSynthesisUtterance(fullText);
      utterance.rate = newRate;
      utterance.pitch = 1;
      
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  const getShareText = () => {
    const lines: string[] = [];
    
    lines.push("🔬 KNOW YOUR FOOD - Analysis Result");
    lines.push("═".repeat(40));
    lines.push("");
    
    // Grade
    if (item.overall_grade) {
      lines.push(`📊 Grade: ${item.overall_grade}`);
      if (item.grade_explanation) {
        lines.push(`   ${item.grade_explanation}`);
      }
      lines.push("");
    }
    
    // Bottom Line
    if (item.bottom_line) {
      lines.push("💡 Bottom Line:");
      lines.push(`   ${item.bottom_line}`);
      lines.push("");
    }
    
    // Verdict/Claims
    if (item.claim_summaries?.length > 0) {
      lines.push("📋 Verdict:");
      item.claim_summaries.forEach((claim: any, i: number) => {
        lines.push(`   ${i + 1}. "${claim.claim_text}"`);
        if (claim.verdict_summary) {
          lines.push(`      → ${claim.verdict_summary}`);
        }
      });
      lines.push("");
    }
    
    // Key Points
    if (item.key_points?.length > 0) {
      lines.push("📌 Key Points:");
      item.key_points.forEach((point: string, i: number) => {
        lines.push(`   ${i + 1}. ${point}`);
      });
      lines.push("");
    }
    
    // Suggested Action
    if (item.suggested_action) {
      lines.push("✅ Recommended Action:");
      lines.push(`   ${item.suggested_action}`);
      lines.push("");
    }
    
    lines.push("─".repeat(40));
    lines.push("Analyzed by Know Your Food App");
    
    return lines.join("\n");
  };

  const getGradeInfo = () => {
    if (item.overall_grade === "Not Applicable")
      return { 
        letter: "—", 
        class: "grade-na", 
        percent: 0,
        meaning: "No health claim detected",
        sortDesc: null
      };
    if (item.overall_grade === "SORT-A" || item.overall_grade === "Accurate")
      return { 
        letter: "A", 
        class: "grade-a", 
        percent: 100,
        meaning: "Strong Evidence",
        sortDesc: "Based on consistent, good-quality, patient-oriented evidence (e.g., meta-analyses of randomized controlled trials)."
      };
    if (item.overall_grade === "SORT-B" || item.overall_grade === "Partially Accurate" || item.overall_grade === "Almost Accurate")
      return { 
        letter: "B", 
        class: "grade-b", 
        percent: 66,
        meaning: "Moderate Evidence",
        sortDesc: "Based on inconsistent or limited-quality patient-oriented evidence (e.g., inconsistent RCTs or small cohort studies)."
      };
    if (item.overall_grade === "Context Dependent")
      return { 
        letter: "B", 
        class: "grade-b", 
        percent: 50,
        meaning: "Context Dependent",
        sortDesc: null
      };
    if (item.overall_grade === "Informational")
      return { 
        letter: "i", 
        class: "grade-b", 
        percent: 66,
        meaning: "Nutritional information & guidance",
        sortDesc: null
      };
    if (item.overall_grade === "Unverifiable")
      return { 
        letter: "?", 
        class: "grade-unknown", 
        percent: 33,
        meaning: "Cannot be verified with available evidence",
        sortDesc: null
      };
    if (item.overall_grade === "SORT-C" || item.overall_grade === "Misleading")
      return { 
        letter: "C", 
        class: "grade-c", 
        percent: 20,
        meaning: "Weak Evidence",
        sortDesc: "Based on consensus, usual practice, opinion, or insufficient patient-oriented evidence."
      };
    return { 
      letter: "C", 
      class: "grade-c", 
      percent: 20,
      meaning: "Insufficient evidence",
      sortDesc: null
    };
  };

  const gradeInfo = getGradeInfo();

  const getSeverityBadge = () => {
    const map: Record<string, { label: string; class: string }> = {
      trivial: { label: "Low Priority", class: "" },
      worth_knowing: { label: "Worth Knowing", class: "badge-info" },
      important: { label: "Important", class: "badge-warning" },
      urgent: { label: "Urgent", class: "badge-danger" },
    };
    return map[item.severity_tier] || null;
  };

  const getConfidenceBadge = () => {
    const map: Record<string, { label: string; class: string }> = {
      very_high: { label: "Very High Confidence", class: "badge-success" },
      high: { label: "High Confidence", class: "badge-success" },
      moderate: { label: "Moderate Confidence", class: "badge-info" },
      low: { label: "Low Confidence", class: "badge-warning" },
      uncertain: { label: "Uncertain", class: "" },
    };
    return map[item.confidence_level] || null;
  };

  const severity = getSeverityBadge();
  const confidence = getConfidenceBadge();

  // Health score for barcode scans
  const getHealthScore = () => {
    const grade = item.overall_grade;
    if (grade === "SORT-A" || grade === "Accurate") {
      return { score: "Good", emoji: "✅", color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/30", desc: "This product appears to be a good choice" };
    }
    if (grade === "SORT-B" || grade === "Almost Accurate" || grade === "Context Dependent") {
      return { score: "Moderate", emoji: "⚠️", color: "text-yellow-400", bgColor: "bg-yellow-500/10", borderColor: "border-yellow-500/30", desc: "This product has some considerations" };
    }
    if (grade === "SORT-C" || grade === "Misleading") {
      return { score: "Caution", emoji: "⛔", color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/30", desc: "This product may not be the healthiest choice" };
    }
    return { score: "Unknown", emoji: "❓", color: "text-white/60", bgColor: "bg-white/5", borderColor: "border-white/20", desc: "Unable to determine health score" };
  };

  const healthScore = isBarcodeScan ? getHealthScore() : null;

  return (
    <div className="mt-6 sm:mt-10 animate-card-enter">
      <div className="glass-vibrant rounded-2xl sm:rounded-3xl overflow-hidden">
        <div className="p-5 sm:p-6 md:p-8 stagger-fast">
          
          {/* Header - Different for barcode scans */}
          {isBarcodeScan ? (
            <>
              {/* Product Analysis Header with Nutri-Score */}
              <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-1 sm:mb-2">
                    Product Analysis
                  </p>
                  <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 sm:mb-3">
                    Nutritional Assessment
                  </h2>
                  
                  {/* Audio Controls */}
                  {isSpeechSupported && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSpeak}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                          isSpeaking 
                            ? "bg-white/15 border border-white/25" 
                            : "bg-white/[0.06] border border-white/[0.08] hover:bg-white/10"
                        }`}
                        title={isSpeaking ? "Stop" : "Listen"}
                      >
                        {isSpeaking ? (
                          <svg className="w-4 h-4 text-white/90" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                        )}
                      </button>
                      
                      {isSpeaking && (
                        <div className="flex items-center gap-1 animate-scale-in">
                          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => handleSpeedChange(rate)}
                              className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                                speechRate === rate
                                  ? "bg-white/20 text-white"
                                  : "text-white/40 hover:text-white/70 hover:bg-white/10"
                              }`}
                            >
                              {rate}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Nutri-Score Badge */}
                {nutriScoreStyle && nutriScore ? (
                  <div className="flex flex-col items-center animate-scale-in flex-shrink-0">
                    <div className={`w-14 h-14 sm:w-16 sm:h-16 ${nutriScoreStyle.bg} rounded-full flex items-center justify-center shadow-lg`}>
                      <span className={`text-2xl sm:text-3xl font-bold ${nutriScoreStyle.text}`}>
                        {nutriScore}
                      </span>
                    </div>
                    <p className="text-[9px] sm:text-[10px] text-white/50 mt-1.5 font-medium">
                      Nutri-Score
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-white/40">
                      {nutriScoreStyle.label}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center animate-scale-in flex-shrink-0">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 bg-white/10 rounded-full flex items-center justify-center">
                      <span className="text-xl sm:text-2xl font-bold text-white/40">—</span>
                    </div>
                    <p className="text-[9px] sm:text-[10px] text-white/50 mt-1.5 font-medium">
                      Nutri-Score
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-white/30">
                      Not available
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Standard Header */}
              <div className="flex items-start justify-between gap-4 mb-6 sm:mb-8">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-1 sm:mb-2">
                    Analysis Complete
                  </p>
                  <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 sm:mb-3">
                    Evidence Assessment
                  </h2>
                  
                  {/* Audio Controls */}
                  {isSpeechSupported && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSpeak}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                          isSpeaking 
                            ? "bg-white/15 border border-white/25" 
                            : "bg-white/[0.06] border border-white/[0.08] hover:bg-white/10"
                        }`}
                        title={isSpeaking ? "Stop" : "Listen"}
                      >
                        {isSpeaking ? (
                          <svg className="w-4 h-4 text-white/90" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="6" width="12" height="12" rx="2" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                        )}
                      </button>
                      
                      {isSpeaking && (
                        <div className="flex items-center gap-1 animate-scale-in">
                          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <button
                              key={rate}
                              onClick={() => handleSpeedChange(rate)}
                              className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                                speechRate === rate
                                  ? "bg-white/20 text-white"
                                  : "text-white/40 hover:text-white/70 hover:bg-white/10"
                              }`}
                            >
                              {rate}x
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 sm:gap-2 flex-shrink-0">
                  <div className={`grade-ring ${gradeInfo.class} animate-scale-in animate-glow-pulse`}>
                    {gradeInfo.letter}
                  </div>
                  <p className="text-[10px] sm:text-xs text-white/40 text-right max-w-[100px] sm:max-w-[140px] animate-fade-in" style={{ animationDelay: '0.3s' }}>
                    {gradeInfo.meaning}
                  </p>
                </div>
              </div>

              {/* Transcribed text - Only for audio analysis */}
              {inputType === "audio" && transcript && (
                <div className="mb-5 sm:mb-6 animate-fade-in stagger-1">
                  <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                    <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                    What we heard
                  </p>
                  <div className="section-glass section-blue rounded-xl sm:rounded-2xl p-4 sm:p-5 accent-line-blue">
                    <p className="text-sm sm:text-base text-white/80 leading-relaxed italic">
                      &ldquo;{transcript}&rdquo;
                    </p>
                    <p className="text-xs text-white/40 mt-3">
                      Verify this matches what you said. If not, try recording again in a quieter environment.
                    </p>
                  </div>
                </div>
              )}

              {/* Red Flags - Not shown for barcode scans */}
              {item.red_flags_detected?.length > 0 && (
                <div className="section-glass section-red rounded-xl sm:rounded-2xl p-4 sm:p-5 mb-5 sm:mb-6 animate-fade-in stagger-1 accent-line-red">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-red-500/10 flex items-center justify-center animate-float flex-shrink-0">
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs sm:text-sm font-medium text-red-300 mb-2 sm:mb-3">
                        Misinformation Patterns Detected
                      </p>
                      <div className="flex flex-wrap gap-1.5 sm:gap-2">
                        {item.red_flags_detected.map((flag: string, i: number) => (
                          <span key={i} className="badge-glow badge-danger text-xs animate-scale-in" style={{ animationDelay: `${i * 0.1}s` }}>
                            {flag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Badges - Not shown for barcode scans */}
          {!isBarcodeScan && (severity || confidence) && (
            <div className="flex flex-wrap gap-3 mb-6 animate-fade-in stagger-2">
              {severity && (
                <span className={`badge-glow ${severity.class} animate-scale-in`}>
                  {severity.label}
                </span>
              )}
              {confidence && (
                <span className={`badge-glow ${confidence.class} animate-scale-in`} style={{ animationDelay: '0.1s' }}>
                  {confidence.label}
                </span>
              )}
            </div>
          )}

          {/* Grade Explanation - Not shown for barcode scans */}
          {!isBarcodeScan && (
            <div className="section-glass section-purple rounded-xl sm:rounded-2xl p-4 sm:p-5 mb-5 sm:mb-6 animate-fade-in stagger-2 accent-line-purple ambient-glow-purple">
              <div className="flex items-center gap-2 sm:gap-3 mb-2 sm:mb-3">
                <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-purple-500/15 flex items-center justify-center flex-shrink-0 animate-icon-pulse">
                  <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <p className="text-xs sm:text-sm font-medium text-purple-300">
                  {item.overall_grade}
                </p>
              </div>
              {gradeInfo.sortDesc && (
                <p className="text-xs text-purple-300/60 mb-3 leading-relaxed border-b border-purple-500/10 pb-3">
                  {gradeInfo.sortDesc}
                </p>
              )}
              <p className="text-sm sm:text-base text-white/70 leading-relaxed">
                {item.grade_explanation}
              </p>
            </div>
          )}

          {/* Verdict - Not shown for barcode scans */}
          {!isBarcodeScan && item.claim_summaries?.length > 0 && (
            <div className="mb-5 sm:mb-6 animate-fade-in stagger-3">
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Verdict
              </p>
              <div className="space-y-3 sm:space-y-4">
                {item.claim_summaries.map((summary: any, i: number) => (
                  <div key={i} className="section-glass section-orange rounded-xl sm:rounded-2xl p-4 sm:p-5 accent-line-orange animate-slide-in-left ambient-glow-orange" style={{ animationDelay: `${i * 0.15}s` }}>
                    <p className="text-sm sm:text-base text-white font-medium mb-2 leading-relaxed">
                      "{summary.claim_text}"
                    </p>
                    <p className="text-white/60 text-xs sm:text-sm leading-relaxed mb-2 sm:mb-3">
                      {summary.verdict_summary}
                    </p>
                    {summary.fallacies_detected?.length > 0 && 
                     summary.fallacies_detected[0] !== "none" && (
                      <div className="flex flex-wrap gap-2">
                        {summary.fallacies_detected.map((f: string, j: number) => (
                          <span key={j} className="badge-glow badge-warning text-xs animate-number-pop" style={{ animationDelay: `${j * 0.08}s` }}>
                            {FALLACY_LABELS[f] || f}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Product Review - Only for barcode scans */}
          {isBarcodeScan && (
            <div className="mb-5 sm:mb-6 animate-fade-in stagger-2">
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Product Overview
              </p>
              <div className="section-glass section-purple rounded-xl sm:rounded-2xl p-4 sm:p-5 accent-line-purple">
                {/* Product-focused summary */}
                {getProductReviewSummary() && (
                  <p className="text-sm sm:text-base text-white font-medium leading-relaxed mb-4">
                    {getProductReviewSummary()}
                  </p>
                )}
                
                {/* AI Assessment */}
                {item.grade_explanation && (
                  <div className={getProductReviewSummary() ? "pt-4 border-t border-white/10" : ""}>
                    <p className="text-xs font-medium text-purple-300 mb-2">Assessment</p>
                    <p className="text-sm text-white/70 leading-relaxed">
                      {item.grade_explanation}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Key Points */}
          {item.key_points?.length > 0 && (
            <div className="mb-5 sm:mb-6 animate-fade-in stagger-4">
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400 animate-icon-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                What You Should Know
              </p>
              <div className="section-glass section-blue rounded-xl sm:rounded-2xl p-4 sm:p-5 accent-line-blue ambient-glow-blue">
                <div className="space-y-3 sm:space-y-4">
                  {item.key_points.map((point: string, i: number) => (
                    <div key={i} className="flex gap-3 sm:gap-4 animate-slide-in-left" style={{ animationDelay: `${i * 0.1}s` }}>
                      <span className="text-blue-400/60 text-xs sm:text-sm font-mono flex-shrink-0 w-5 animate-number-pop" style={{ animationDelay: `${i * 0.1}s` }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <p className="text-sm sm:text-base text-white/75 leading-relaxed flex-1">
                        {point}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Bottom Line - Not shown for barcode scans (included in Product Review) */}
          {!isBarcodeScan && item.bottom_line && (
            <div className="mb-5 sm:mb-6 animate-fade-in stagger-5">
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-400 animate-float" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                Bottom Line
              </p>
              <div className="section-glass section-purple rounded-xl sm:rounded-2xl p-4 sm:p-5 accent-line-purple animate-border-flow ambient-glow-purple">
                <p className="text-white text-base sm:text-lg font-medium leading-relaxed">
                  {item.bottom_line}
                </p>
              </div>
            </div>
          )}

          {/* Suggested Action */}
          {item.suggested_action && (
            <div className="mb-5 sm:mb-6 animate-fade-in stagger-6">
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-400 animate-float" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                Recommended Action
              </p>
              <div className="section-glass section-green rounded-xl sm:rounded-2xl p-4 sm:p-5 accent-line-green ambient-glow-green">
                <p className="text-sm sm:text-base text-white/90 leading-relaxed">
                  {item.suggested_action}
                </p>
              </div>
            </div>
          )}

          {/* References - Not shown for barcode scans */}
          {!isBarcodeScan && item.relevant_studies?.length > 0 && (
            <div className="mb-5 sm:mb-6 animate-fade-in stagger-6">
              <p className="text-[10px] sm:text-xs font-medium text-white/40 uppercase tracking-widest mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2">
                <svg className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Scientific References
              </p>
              <div className="section-glass rounded-xl sm:rounded-2xl p-4 sm:p-5">
                <div className="space-y-2.5 sm:space-y-3">
                  {item.relevant_studies.map((study: any, i: number) => (
                    <a
                      key={i}
                      href={study.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-xs sm:text-sm text-blue-400 ref-link animate-slide-in-left touch-target"
                      style={{ animationDelay: `${i * 0.1}s` }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400/60 mt-1.5 flex-shrink-0" />
                      <span className="flex-1">{study.title} →</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="divider" />

          {/* Footer */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
            <p className="text-[10px] sm:text-xs text-white/30 text-center sm:text-left">
              AI-generated analysis · Verify important decisions
            </p>
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={() => setShowFeedback(true)}
                className="btn-glass px-4 h-10 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 touch-target flex-1 sm:flex-none justify-center"
                title="Report issue"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
                </svg>
                <span className="hidden sm:inline">Report</span>
              </button>
              <button
                onClick={() => setShowShareMenu(true)}
                className="btn-glass px-4 sm:px-5 h-10 rounded-lg sm:rounded-xl text-xs sm:text-sm font-medium flex items-center gap-2 touch-target flex-1 sm:flex-none justify-center"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Social Share Menu */}
      <SocialShareMenu
        isOpen={showShareMenu}
        onClose={() => setShowShareMenu(false)}
        shareText={getShareText()}
      />
      
      {/* Feedback Modal */}
      <FeedbackModal
        isOpen={showFeedback}
        onClose={() => setShowFeedback(false)}
        grade={item.overall_grade}
      />
    </div>
  );
}

/* ===========================
   User Menu Component
=========================== */

function UserMenu({ analysisCount = 0 }: { analysisCount?: number }) {
  const { user, credits, setCredits, signInWithGoogle, signOut, refreshCredits, loading: authLoading, firebaseReady } = useAuth();
  const [open, setOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isIndian = typeof window !== "undefined" && (
    localStorage.getItem("kyf-user-country") === "IN" ||
    (!localStorage.getItem("kyf-user-country") && (
      Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata" ||
      Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Calcutta"
    ))
  );
  const currency = isIndian ? "₹" : "$";

  const creditPacks = [
    { id: "starter", credits: 20, priceUSD: 0.99, priceINR: 79, label: "Starter", popular: false },
    { id: "value", credits: 60, priceUSD: 1.99, priceINR: 149, label: "Value Pack", popular: true },
    { id: "pro", credits: 150, priceUSD: 3.99, priceINR: 329, label: "Pro Pack", popular: false },
    { id: "mega", credits: 500, priceUSD: 9.99, priceINR: 799, label: "Mega Pack", popular: false },
  ];
  const getPrice = (pack: typeof creditPacks[0]) => isIndian ? pack.priceINR : pack.priceUSD;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!firebaseReady) {
    return <div className="w-10" />;
  }

  if (authLoading) {
    return <div className="w-10 h-10 rounded-xl bg-white/[0.06] animate-gentle-pulse" />;
  }

  const guestName = typeof window !== "undefined" ? localStorage.getItem("kyf-user-name") || "Guest" : "Guest";
  const anonRemaining = getAnonCreditsRemaining();

  if (!user) {
    return (
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center gap-2 px-2 tap-highlight hover:bg-white/10 transition-colors"
        >
          <div className="w-7 h-7 rounded-lg bg-white/[0.12] flex items-center justify-center">
            <svg className="w-4 h-4 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <span className="text-xs font-medium text-white/50 hidden sm:inline">{guestName}</span>
        </button>

        {open && typeof document !== "undefined" && createPortal(
          <>
            <div className="fixed inset-0 bg-black/50 z-[998]" onClick={() => setOpen(false)} />
            <div className="fixed left-4 right-4 top-20 max-w-sm mx-auto rounded-2xl border border-white/[0.15] z-[999] overflow-hidden bg-black"
                 onMouseDown={(e) => e.stopPropagation()}
                 style={{ boxShadow: "0 20px 60px rgba(0,0,0,1)" }}>

              <div className="px-4 pt-5 pb-4 flex items-center gap-3.5 border-b border-white/[0.15]">
                <div className="w-14 h-14 rounded-2xl bg-white/[0.08] ring-2 ring-white/[0.15] flex items-center justify-center flex-shrink-0">
                  <svg className="w-7 h-7 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-white truncate">{guestName}</p>
                  <p className="text-xs text-white/50">Guest account</p>
                </div>
              </div>

              <div className="px-4 py-3 border-b border-white/[0.15]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-white/70 uppercase tracking-wider">Daily Analyses</span>
                  <span className="text-lg font-bold text-amber-400 tabular-nums">{anonRemaining}/{ANON_DAILY_LIMIT}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-white/[0.15] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
                    style={{ width: `${(anonRemaining / ANON_DAILY_LIMIT) * 100}%` }}
                  />
                </div>
                <p className="text-[11px] text-white/50 mt-1.5">Sign in with Google for {SIGNUP_BONUS} free credits + more features</p>
              </div>

              <div className="p-2 space-y-0.5">
                {firebaseReady && (
                  <button
                    onClick={() => { signInWithGoogle(); setOpen(false); }}
                    className="w-full text-left px-3 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors flex items-center gap-2.5"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    Sign in with Google
                  </button>
                )}
                <button
                  onClick={() => { setShowAbout(true); setOpen(false); }}
                  className="w-full text-left px-3 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors flex items-center gap-2.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  About this app
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    localStorage.removeItem("kyf-welcomed");
                    localStorage.removeItem("kyf-user-details");
                    window.location.reload();
                  }}
                  className="w-full text-left px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.12] rounded-xl transition-colors flex items-center gap-2.5 font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                  Sign out
                </button>
              </div>
            </div>
          </>,
          document.body
        )}

        {showAbout && typeof document !== "undefined" && createPortal(
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={() => setShowAbout(false)} />
            <div className="relative bg-[#111] border border-white/[0.15] rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }}>
              <div className="sticky top-0 bg-[#111] border-b border-white/[0.1] px-5 py-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">Know Your Food</h3>
                <button onClick={() => setShowAbout(false)} className="w-8 h-8 rounded-lg bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="px-5 py-4 space-y-5">
                <div>
                  <h4 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-2">Why this app exists</h4>
                  <p className="text-sm text-white/70 leading-relaxed">
                    Every day we see health claims on social media, food labels, and news articles. Many are misleading or lack context.
                    Know Your Food uses AI and scientific research to give you evidence-based answers so you can make informed decisions about your health and nutrition.
                  </p>
                </div>
                <div className="border-t border-white/[0.1] pt-4">
                  <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">How to use</h4>
                  <div className="space-y-3">
                    <div className="flex gap-3"><div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0 text-sm">💬</div><div><p className="text-sm font-medium text-white/90">Type a claim</p><p className="text-xs text-white/50">E.g. &quot;Eating bananas at night causes weight gain&quot;</p></div></div>
                    <div className="flex gap-3"><div className="w-7 h-7 rounded-lg bg-pink-500/20 flex items-center justify-center flex-shrink-0 text-sm">🔗</div><div><p className="text-sm font-medium text-white/90">Paste a reel or shorts URL</p><p className="text-xs text-white/50">Instagram reels, YouTube shorts with health claims</p></div></div>
                    <div className="flex gap-3"><div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0 text-sm">🎤</div><div><p className="text-sm font-medium text-white/90">Record your voice</p><p className="text-xs text-white/50">Speak the claim and it auto-stops after 3s of silence</p></div></div>
                    <div className="flex gap-3"><div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center flex-shrink-0 text-sm">📷</div><div><p className="text-sm font-medium text-white/90">Upload images</p><p className="text-xs text-white/50">Food labels, product claims — up to 5 images at once</p></div></div>
                    <div className="flex gap-3"><div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0 text-sm">📦</div><div><p className="text-sm font-medium text-white/90">Scan a barcode</p><p className="text-xs text-white/50">Scan any food product barcode for nutritional analysis (free)</p></div></div>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    );
  }

  const memberSince = user.metadata?.creationTime
    ? new Date(user.metadata.creationTime).toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center gap-2 px-2 tap-highlight hover:bg-white/10 transition-colors"
      >
        {user.photoURL ? (
          <img src={user.photoURL} alt="" className="w-7 h-7 rounded-lg" referrerPolicy="no-referrer" />
        ) : (
          <div className="w-7 h-7 rounded-lg bg-indigo-500/30 flex items-center justify-center text-xs font-bold text-indigo-300">
            {(user.displayName || user.email || "U")[0].toUpperCase()}
          </div>
        )}
        <span className="text-xs font-medium text-amber-400/80 tabular-nums hidden sm:inline">
          {credits} ✦
        </span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <>
          <div className="fixed inset-0 bg-black/50 z-[998]" onClick={() => setOpen(false)} />
          <div className="fixed left-4 right-4 top-20 max-w-sm mx-auto rounded-2xl border border-white/[0.15] z-[999] overflow-hidden bg-black"
               onMouseDown={(e) => e.stopPropagation()}
               style={{ boxShadow: "0 20px 60px rgba(0,0,0,1)" }}>

            <div className="px-4 pt-5 pb-4 flex items-center gap-3.5 border-b border-white/[0.15]">
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-14 h-14 rounded-2xl ring-2 ring-indigo-500/40 flex-shrink-0" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/25 ring-2 ring-indigo-500/40 flex items-center justify-center text-xl font-bold text-indigo-300 flex-shrink-0">
                  {(user.displayName || user.email || "U")[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-white truncate">{user.displayName || "User"}</p>
                <p className="text-xs text-white/70 truncate">{user.email}</p>
                {memberSince && (
                  <p className="text-[11px] text-white/50 mt-0.5">Member since {memberSince}</p>
                )}
              </div>
            </div>

            <div className="px-4 py-3 border-b border-white/[0.15]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-white/70 uppercase tracking-wider">Credits</span>
                <span className="text-lg font-bold text-amber-400 tabular-nums">{credits} ✦</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/[0.15] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
                  style={{ width: `${Math.min(100, (credits / SIGNUP_BONUS) * 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[11px] text-white/50">Text: {CREDIT_COST_TEXT} cr &middot; Media: {CREDIT_COST_MEDIA} cr &middot; Barcode: Free</p>
              </div>
            </div>

            <div className="px-4 py-3 border-b border-white/[0.15]">
              <p className="text-[10px] font-medium text-white/60 uppercase tracking-wider mb-2">Earn Credits</p>
              <div className="space-y-1.5">
                <button
                  onClick={async () => {
                    if (!user) return;
                    if (typeof window !== "undefined" && (window as any).__showRewardedAd) {
                      (window as any).__showRewardedAd();
                    } else {
                      const newCredits = await claimRewardedAdCredit(user.uid);
                      if (newCredits > 0) { setCredits(newCredits); refreshCredits(); }
                    }
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm rounded-xl transition-colors flex items-center gap-2.5 bg-amber-500/[0.15] hover:bg-amber-500/[0.25] text-amber-300"
                >
                  <span className="text-base">▶</span>
                  <span className="flex-1">Watch ad</span>
                  <span className="text-xs text-amber-400/80">+{REWARDED_AD_CREDITS} cr</span>
                </button>
                <div className="flex items-center gap-2.5 px-3 py-2 text-sm text-white/60">
                  <span className="text-base">📤</span>
                  <span className="flex-1">Share a result</span>
                  <span className="text-xs text-white/50">+{SHARE_REWARD} cr &middot; {SHARE_DAILY_MAX - getSharesToday()}/{SHARE_DAILY_MAX}</span>
                </div>
                <button
                  onClick={() => { setShowBuyCredits(true); setOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm rounded-xl transition-colors flex items-center gap-2.5 bg-indigo-500/[0.15] hover:bg-indigo-500/[0.25] text-indigo-300"
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="flex-1">Buy credits</span>
                  <span className="text-xs text-indigo-400/80">from {currency}{isIndian ? "79" : "0.99"}</span>
                </button>
              </div>
            </div>

            <div className="px-4 py-3 grid grid-cols-2 gap-2 border-b border-white/[0.15]">
              <div className="bg-white/[0.08] rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-white tabular-nums">{analysisCount}</p>
                <p className="text-[10px] text-white/60 uppercase tracking-wider">Analyses</p>
              </div>
              <div className="bg-white/[0.08] rounded-xl px-3 py-2.5 text-center">
                <p className="text-lg font-bold text-emerald-400">Free</p>
                <p className="text-[10px] text-white/60 uppercase tracking-wider">Plan</p>
              </div>
            </div>

            <div className="p-2 space-y-0.5">
              <button
                onClick={() => { setShowAbout(true); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/[0.08] rounded-xl transition-colors flex items-center gap-2.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                About this app
              </button>
              <button
                onClick={() => { setShowSignOutConfirm(true); setOpen(false); }}
                className="w-full text-left px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.12] rounded-xl transition-colors flex items-center gap-2.5 font-medium"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign out
              </button>
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Sign Out Confirmation */}
      {showSignOutConfirm && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowSignOutConfirm(false)} />
          <div className="relative bg-[#111] border border-white/[0.15] rounded-2xl p-6 max-w-xs w-full text-center" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }}>
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/15 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">Sign out?</h3>
            <p className="text-sm text-white/50 mb-6">Your credits and history will be saved for when you return.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSignOutConfirm(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white/70 bg-white/[0.08] hover:bg-white/[0.12] rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  signOut();
                  setShowSignOutConfirm(false);
                  localStorage.removeItem("kyf-welcomed");
                  localStorage.removeItem("kyf-user-details");
                  window.location.reload();
                }}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500/80 hover:bg-red-500 rounded-xl transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* About This App Modal */}
      {showAbout && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowAbout(false)} />
          <div className="relative bg-[#111] border border-white/[0.15] rounded-2xl max-w-md w-full max-h-[80vh] overflow-y-auto" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }}>
            <div className="sticky top-0 bg-[#111] border-b border-white/[0.1] px-5 py-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Know Your Food</h3>
              <button onClick={() => setShowAbout(false)} className="w-8 h-8 rounded-lg bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              <div>
                <h4 className="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-2">Why this app exists</h4>
                <p className="text-sm text-white/70 leading-relaxed">
                  Every day we see health claims on social media, food labels, and news articles. Many are misleading or lack context.
                  Know Your Food uses AI and scientific research to give you evidence-based answers so you can make informed decisions about your health and nutrition.
                </p>
              </div>

              <div className="border-t border-white/[0.1] pt-4">
                <h4 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-3">How to use</h4>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center flex-shrink-0 text-sm">💬</div>
                    <div>
                      <p className="text-sm font-medium text-white/90">Type a claim</p>
                      <p className="text-xs text-white/50">E.g. &quot;Eating bananas at night causes weight gain&quot;</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-pink-500/20 flex items-center justify-center flex-shrink-0 text-sm">🔗</div>
                    <div>
                      <p className="text-sm font-medium text-white/90">Paste a reel or shorts URL</p>
                      <p className="text-xs text-white/50">Instagram reels, YouTube shorts with health claims</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0 text-sm">🎤</div>
                    <div>
                      <p className="text-sm font-medium text-white/90">Record your voice</p>
                      <p className="text-xs text-white/50">Speak the claim and it auto-stops after 3s of silence</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-teal-500/20 flex items-center justify-center flex-shrink-0 text-sm">📷</div>
                    <div>
                      <p className="text-sm font-medium text-white/90">Upload images</p>
                      <p className="text-xs text-white/50">Food labels, product claims — up to 5 images at once</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0 text-sm">📦</div>
                    <div>
                      <p className="text-sm font-medium text-white/90">Scan a barcode</p>
                      <p className="text-xs text-white/50">Scan any food product barcode for nutritional analysis (free)</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="border-t border-white/[0.1] pt-4">
                <h4 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-2">Credits</h4>
                <p className="text-sm text-white/70 leading-relaxed mb-2">
                  Each analysis uses credits. Text costs {CREDIT_COST_TEXT} credit, media (URLs, images, audio) costs {CREDIT_COST_MEDIA} credits, and barcode scans are free. You can earn credits by:
                </p>
                <ul className="text-sm text-white/60 space-y-1 ml-1">
                  <li className="flex items-center gap-2"><span className="text-amber-400">▶</span> Watching a short ad (+{REWARDED_AD_CREDITS} cr)</li>
                  <li className="flex items-center gap-2"><span className="text-amber-400">📤</span> Sharing results (+{SHARE_REWARD} cr)</li>
                  <li className="flex items-center gap-2"><span className="text-amber-400">📅</span> Daily login bonus (+2 cr)</li>
                </ul>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Buy Credits Modal */}
      {showBuyCredits && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowBuyCredits(false)} />
          <div className="relative bg-[#111] border border-white/[0.15] rounded-2xl max-w-sm w-full overflow-hidden" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }}>
            <div className="px-5 py-4 border-b border-white/[0.1] flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Buy Credits</h3>
              <button onClick={() => setShowBuyCredits(false)} className="w-8 h-8 rounded-lg bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="px-5 py-4 space-y-2.5">
              {creditPacks.map((pack) => {
                const price = getPrice(pack);
                return (
                  <button
                    key={pack.id}
                    onClick={() => {
                      alert(`Payment integration coming soon! You selected: ${pack.label} (${pack.credits} credits for ${currency}${price})`);
                    }}
                    className={`w-full rounded-xl p-3.5 border transition-colors text-left relative ${
                      pack.popular
                        ? "border-amber-500/40 bg-amber-500/[0.08] hover:bg-amber-500/[0.15]"
                        : "border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08]"
                    }`}
                  >
                    {pack.popular && (
                      <span className="absolute -top-2.5 right-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-black rounded-full">
                        Best Value
                      </span>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{pack.label}</p>
                        <p className="text-xs text-white/50 mt-0.5">
                          {pack.credits} credits &middot; ~{Math.floor(pack.credits / CREDIT_COST_TEXT)} text or ~{Math.floor(pack.credits / CREDIT_COST_MEDIA)} media analyses
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="text-lg font-bold text-white">{currency}{price}</p>
                        <p className="text-[10px] text-white/40">{currency}{(price / pack.credits).toFixed(isIndian ? 1 : 3)}/cr</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="px-5 py-3 border-t border-white/[0.1]">
              <p className="text-[11px] text-white/40 text-center">
                Credits never expire. You can also earn free credits by watching ads or sharing results.
              </p>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/* ===========================
   Main Page Component
=========================== */

function HomeContent() {
  const { user, credits, refreshCredits, setCredits, signInWithGoogle, firebaseReady } = useAuth();
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  
  // New state for features
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [currentInputType, setCurrentInputType] = useState<"text" | "audio" | "image" | "barcode">("text");
  const [isUrlInput, setIsUrlInput] = useState(false);
  const [nutriScore, setNutriScore] = useState<string | null>(null);
  const [productDetails, setProductDetails] = useState<{
    name: string;
    brand?: string;
    calories?: number;
    fat?: number;
    sugar?: number;
    protein?: number;
    novaGroup?: number;
  } | null>(null);
  const [productNotFound, setProductNotFound] = useState<{ barcode: string; show: boolean } | null>(null);
  const [showNoCreditModal, setShowNoCreditModal] = useState(false);
  const [showBuyCreditsModal, setShowBuyCreditsModal] = useState(false);
  const [stagedImages, setStagedImages] = useState<File[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSavedResultRef = useRef<string | null>(null);

  // Load history on mount and track component lifecycle
  useEffect(() => {
    console.log("[HomeContent] Component MOUNTED");
    setHistory(getHistory());
    
    return () => {
      console.log("[HomeContent] Component UNMOUNTED");
    };
  }, []);

  // Debug: Track result state changes
  useEffect(() => {
    console.log("[Result State] Changed to:", result ? "HAS_DATA" : "NULL", result?.is_relevant, result?.overall_assessment ? "HAS_ASSESSMENT" : "NO_ASSESSMENT");
  }, [result]);

  // Save to history when result changes (with duplicate prevention)
  useEffect(() => {
    try {
      if (result && result.is_relevant !== false && result.overall_assessment) {
        const resultId = JSON.stringify(result.overall_assessment?.bottom_line || result).slice(0, 100);
        
        if (lastSavedResultRef.current === resultId) {
          return;
        }
        lastSavedResultRef.current = resultId;
        
        const assessment = result.overall_assessment;
        const historyItem = saveToHistory({
          inputType: currentInputType,
          inputSummary: inputText.slice(0, 100) || "Audio/Image analysis",
          grade: assessment.overall_grade || "Unknown",
          result: result,
        });
        setHistory((prev) => [historyItem, ...prev].slice(0, MAX_HISTORY_ITEMS));

        if (user) {
          const inputType = isUrlInput ? "url" : currentInputType === "audio" ? "audio" : currentInputType === "image" ? "image" : "text";
          saveAnalysisToFirestore(
            user.uid,
            inputText.slice(0, 500) || "Audio/Image analysis",
            inputType,
            result,
            assessment.overall_grade || "Unknown"
          ).catch((e) => console.warn("Firestore save failed:", e));
        }
      }
    } catch (err) {
      console.warn("Error saving to history:", err);
    }
  }, [result, currentInputType, inputText, user, isUrlInput]);

  const handleHistorySelect = (item: HistoryItem) => {
    setResult(item.result);
    setInputText(item.inputSummary);
    setShowHistory(false);
  };

  const handleHistoryDelete = (id: string) => {
    deleteFromHistory(id);
    setHistory((prev) => prev.filter((item) => item.id !== id));
  };

  const handleHistoryClear = () => {
    clearHistory();
    setHistory([]);
  };

  const hasEnoughCredits = async (cost: number = CREDIT_COST_TEXT): Promise<boolean> => {
    if (!firebaseReady) return true;
    if (user) {
      const current = await getUserCredits(user.uid);
      if (current < cost) { setShowNoCreditModal(true); return false; }
      return true;
    }
    const remaining = getAnonCreditsRemaining();
    if (remaining <= 0) { setShowNoCreditModal(true); return false; }
    return true;
  };

  const consumeCredit = async (cost: number = CREDIT_COST_TEXT): Promise<void> => {
    if (!firebaseReady) return;
    if (user) {
      await consumeUserCredits(user.uid, cost);
      setCredits(credits - cost);
    } else {
      consumeAnonCredit();
    }
  };

  const handleManualProductEntry = async (productInfo: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setProductNotFound(null);
    setCurrentInputType("barcode");
    setResult(null);
    setLoading(true);
    setError("");

    try {
      const analysisText = `Analyze this food product for health claims and concerns: ${productInfo}`;
      
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_text: analysisText }),
        signal: abortControllerRef.current.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Backend error");

      setResult(data);
      setInputText(productInfo.split(". ")[0].replace("Product: ", ""));
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to analyze product");
    }

    setLoading(false);
  };

  const handleBarcodeScan = async (barcode: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setCurrentInputType("barcode");
    setResult(null);
    setNutriScore(null);
    setProductDetails(null);
    setProductNotFound(null);
    setLoading(true);
    setError("");
    setInputText(`Product barcode: ${barcode}`);

    try {
      // Fetch product info from Open Food Facts API
      const productRes = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
        { signal: abortControllerRef.current.signal }
      );
      const productData = await productRes.json();
      
      if (productData.status === 0) {
        setProductNotFound({ barcode, show: true });
        setLoading(false);
        return;
      }

      const product = productData.product;
      const productInfo = [
        `Product: ${product.product_name || "Unknown"}`,
        product.brands ? `Brand: ${product.brands}` : "",
        product.ingredients_text ? `Ingredients: ${product.ingredients_text}` : "",
        product.nutriments ? `Nutrition per 100g: Calories: ${product.nutriments["energy-kcal_100g"] || "N/A"}kcal, Fat: ${product.nutriments.fat_100g || "N/A"}g, Sugar: ${product.nutriments.sugars_100g || "N/A"}g, Protein: ${product.nutriments.proteins_100g || "N/A"}g` : "",
        product.nutrition_grades ? `Nutri-Score: ${product.nutrition_grades.toUpperCase()}` : "",
        product.nova_group ? `NOVA Group: ${product.nova_group} (food processing level)` : "",
      ].filter(Boolean).join(". ");

      const analysisText = `Analyze this food product for health claims and concerns: ${productInfo}`;
      
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_text: analysisText }),
        signal: abortControllerRef.current.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Backend error");

      setResult(data);
      setNutriScore(product.nutrition_grades?.toUpperCase() || null);
      setProductDetails({
        name: product.product_name || "Unknown Product",
        brand: product.brands || undefined,
        calories: product.nutriments?.["energy-kcal_100g"],
        fat: product.nutriments?.fat_100g,
        sugar: product.nutriments?.sugars_100g,
        protein: product.nutriments?.proteins_100g,
        novaGroup: product.nova_group,
      });
      setInputText(`${product.product_name || "Product"} (${barcode})`);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Failed to analyze product");
    }

    setLoading(false);
  };

  const cancelAnalysis = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setError("");
  };

  const handleAnalyze = async () => {
    if (stagedImages.length > 0) {
      return analyzeImages();
    }

    if (!inputText.trim()) {
      setError("Please enter a claim or paste the reel or YouTube Shorts link");
      return;
    }

    const trimmed = inputText.trim();
    const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /\.(com|net|org|io)\//i.test(trimmed);
    const cost = looksLikeUrl ? CREDIT_COST_MEDIA : CREDIT_COST_TEXT;

    const canProceed = await hasEnoughCredits(cost);
    if (!canProceed) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    setIsUrlInput(looksLikeUrl);
    setCurrentInputType("text");
    setResult(null);
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input_text: inputText }),
        signal: abortControllerRef.current.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Backend error");

      setResult(data);
      await consumeCredit(cost);
    } catch (err: any) {
      if (err.name === "AbortError") {
        return;
      }
      setError(err.message || "Something went wrong");
    }

    setLoading(false);
    setIsUrlInput(false);
  };

  const stopRecording = () => {
    if (silenceCheckRef.current) {
      clearInterval(silenceCheckRef.current);
      silenceCheckRef.current = null;
    }
    audioContextRef.current?.close();
    audioContextRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = handleAudioUpload;
      recorder.start();
      setIsRecording(true);

      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const SILENCE_THRESHOLD = 0.015;
      const CHECK_INTERVAL = 250;
      const SILENCE_DURATION_MS = 3000;
      let silentSince = 0;

      silenceCheckRef.current = setInterval(() => {
        try {
          analyser.getByteFrequencyData(dataArray);
          const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
          const volume = avg / 255;

          if (volume < SILENCE_THRESHOLD) {
            silentSince += CHECK_INTERVAL;
            if (silentSince >= SILENCE_DURATION_MS) {
              stopRecording();
            }
          } else {
            silentSince = 0;
          }
        } catch {
          silentSince = 0;
        }
      }, CHECK_INTERVAL);
    } catch {
      setError("Microphone access denied");
    }
  };

  const handleAudioUpload = async () => {
    const chunks = audioChunksRef.current;
    if (!chunks.length) {
      setError("No audio recorded. Please try again and speak before stopping.");
      return;
    }

    const canProceed = await hasEnoughCredits(CREDIT_COST_MEDIA);
    if (!canProceed) return;

    const blob = new Blob(chunks, { type: "audio/webm" });
    const formData = new FormData();
    formData.append("file", blob, "audio.webm");
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    setCurrentInputType("audio");
    setInputText("Voice recording");
    setResult(null);
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/analyze/audio`, {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Audio error");

      setResult(data);
      await consumeCredit(CREDIT_COST_MEDIA);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      const msg = err.message || "Audio analysis failed";
      setError(typeof msg === "string" ? msg : "Audio analysis failed");
    }

    setLoading(false);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles = Array.from(files);
    setStagedImages((prev) => {
      const combined = [...prev, ...newFiles].slice(0, 5);
      return combined;
    });
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeStagedImage = (index: number) => {
    setStagedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const analyzeImages = async () => {
    if (stagedImages.length === 0) return;

    const canProceed = await hasEnoughCredits(CREDIT_COST_MEDIA);
    if (!canProceed) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setCurrentInputType("image");
    setResult(null);
    setLoading(true);
    setError("");

    const formData = new FormData();
    stagedImages.forEach((file) => formData.append("files", file));
    if (inputText.trim()) {
      formData.append("additional_text", inputText.trim());
    }

    try {
      const res = await fetch(`${API_URL}/analyze/images`, {
        method: "POST",
        body: formData,
        signal: abortControllerRef.current.signal,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Image error");

      setResult(data);
      await consumeCredit(CREDIT_COST_MEDIA);
      setStagedImages([]);
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message || "Image analysis failed");
    }

    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleAnalyze();
    }
  };

  return (
    <>
      <AnimatedBackground />
      
      {/* History Panel */}
      <HistoryPanel
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        history={history}
        onSelect={handleHistorySelect}
        onDelete={handleHistoryDelete}
        onClear={handleHistoryClear}
      />
      
      {/* Barcode Scanner */}
      <BarcodeScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleBarcodeScan}
      />

      {/* No Credits Modal */}
      {showNoCreditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 animate-fade-in" onClick={() => setShowNoCreditModal(false)}>
          <div className="rounded-2xl p-6 max-w-sm w-full animate-scale-in border border-white/[0.12]" style={{ background: "linear-gradient(145deg, #1e1e2e 0%, #181825 100%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="text-center mb-5">
              <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <span className="text-2xl">✦</span>
              </div>
              <h3 className="text-lg font-semibold text-white mb-1">Out of Credits</h3>
              <p className="text-sm text-white/50">
                {user ? "You've used all your credits." : "You've used your 3 free analyses for today."}
              </p>
            </div>
            <div className="space-y-2">
              {!user && (
                <button
                  onClick={async () => { await signInWithGoogle(); setShowNoCreditModal(false); }}
                  className="w-full py-3 rounded-xl bg-white/90 text-black font-medium text-sm flex items-center justify-center gap-2 tap-highlight"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in for {SIGNUP_BONUS} free credits
                </button>
              )}
              {user && (
                <button
                  onClick={async () => {
                    if (typeof window !== "undefined" && (window as any).__showRewardedAd) {
                      (window as any).__showRewardedAd();
                    } else {
                      const newCredits = await claimRewardedAdCredit(user.uid);
                      if (newCredits > 0) setCredits(newCredits);
                    }
                    setShowNoCreditModal(false);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500/80 to-orange-500/80 text-white font-medium text-sm flex items-center justify-center gap-2 tap-highlight"
                >
                  <span className="text-lg">▶</span>
                  Watch an ad for {REWARDED_AD_CREDITS} credits
                </button>
              )}
              {user && (
                <button
                  onClick={() => { setShowNoCreditModal(false); setShowBuyCreditsModal(true); }}
                  className="w-full py-3 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-medium text-sm flex items-center justify-center gap-2 tap-highlight hover:bg-indigo-500/30 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Buy credits
                </button>
              )}
              <button
                onClick={() => setShowNoCreditModal(false)}
                className="w-full py-3 rounded-xl bg-white/[0.06] text-white/60 text-sm tap-highlight hover:bg-white/[0.1] transition-colors"
              >
                Maybe later
              </button>
            </div>
            {user && (
              <p className="text-[11px] text-white/25 text-center mt-4">
                Share results to earn {SHARE_REWARD} credit each (max {SHARE_DAILY_MAX}/day)
              </p>
            )}
          </div>
        </div>
      )}

      {/* Buy Credits Modal (from NoCreditModal) */}
      {showBuyCreditsModal && (() => {
        const isIN = typeof window !== "undefined" && (
          localStorage.getItem("kyf-user-country") === "IN" ||
          (!localStorage.getItem("kyf-user-country") && (
            Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata" ||
            Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Calcutta"
          ))
        );
        const cur = isIN ? "₹" : "$";
        const packs = [
          { id: "starter", credits: 20, priceUSD: 0.99, priceINR: 79, label: "Starter", popular: false },
          { id: "value", credits: 60, priceUSD: 1.99, priceINR: 149, label: "Value Pack", popular: true },
          { id: "pro", credits: 150, priceUSD: 3.99, priceINR: 329, label: "Pro Pack", popular: false },
          { id: "mega", credits: 500, priceUSD: 9.99, priceINR: 799, label: "Mega Pack", popular: false },
        ];
        return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 animate-fade-in" onClick={() => setShowBuyCreditsModal(false)}>
          <div className="bg-[#111] border border-white/[0.15] rounded-2xl max-w-sm w-full overflow-hidden animate-scale-in" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.9)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-white/[0.1] flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">Buy Credits</h3>
              <button onClick={() => setShowBuyCreditsModal(false)} className="w-8 h-8 rounded-lg bg-white/[0.08] flex items-center justify-center text-white/50 hover:text-white transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="px-5 py-4 space-y-2.5">
              {packs.map((pack) => {
                const price = isIN ? pack.priceINR : pack.priceUSD;
                return (
                  <button
                    key={pack.id}
                    onClick={() => {
                      alert(`Payment integration coming soon! You selected: ${pack.label} (${pack.credits} credits for ${cur}${price})`);
                    }}
                    className={`w-full rounded-xl p-3.5 border transition-colors text-left relative ${
                      pack.popular
                        ? "border-amber-500/40 bg-amber-500/[0.08] hover:bg-amber-500/[0.15]"
                        : "border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08]"
                    }`}
                  >
                    {pack.popular && (
                      <span className="absolute -top-2.5 right-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-amber-500 text-black rounded-full">
                        Best Value
                      </span>
                    )}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">{pack.label}</p>
                        <p className="text-xs text-white/50 mt-0.5">
                          {pack.credits} credits &middot; ~{Math.floor(pack.credits / CREDIT_COST_TEXT)} text or ~{Math.floor(pack.credits / CREDIT_COST_MEDIA)} media analyses
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 ml-3">
                        <p className="text-lg font-bold text-white">{cur}{price}</p>
                        <p className="text-[10px] text-white/40">{cur}{(price / pack.credits).toFixed(isIN ? 1 : 3)}/cr</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-white/[0.1]">
              <p className="text-[11px] text-white/40 text-center">
                Credits never expire. You can also earn free credits by watching ads or sharing results.
              </p>
            </div>
          </div>
        </div>
        );
      })()}
      
      <main className="min-h-screen min-h-dvh px-4 sm:px-6 py-12 pt-[max(48px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] md:py-24">
        <div className="max-w-2xl mx-auto">
          
          {/* Header */}
          <div className="flex items-center justify-between mb-6 sm:mb-8 animate-fade-in">
            <UserMenu analysisCount={history.length} />
            <div className="text-center flex-1">
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-semibold mb-2 sm:mb-3 tracking-tight animate-header-gradient">
                Know Your Food
              </h1>
              <p className="text-xs sm:text-base text-white/40">
                Science-backed analysis of health claims
              </p>
            </div>
            <button
              onClick={() => setShowHistory(true)}
              className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center tap-highlight relative"
              aria-label="View history"
            >
              <svg className="w-5 h-5 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {history.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[10px] font-medium flex items-center justify-center animate-bounce-in">
                  {history.length > 9 ? "9+" : history.length}
                </span>
              )}
            </button>
          </div>

          {/* Input Card */}
          <div className="glass-vibrant rounded-2xl sm:rounded-3xl p-4 sm:p-6 md:p-8 animate-card-enter" style={{ animationDelay: "0.1s" }}>
            <input
              type="text"
              placeholder={stagedImages.length > 0 ? "Add a concern or question about these images (optional)..." : "Type a claim or paste Reel / YT Shorts URL..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="glass-input mb-4 sm:mb-5 text-base"
            />

            {/* Staged Image Thumbnails */}
            {stagedImages.length > 0 && (
              <div className="mb-4 sm:mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/50">{stagedImages.length}/5 image{stagedImages.length > 1 ? "s" : ""} selected</span>
                  <button
                    onClick={() => setStagedImages([])}
                    className="text-xs text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {stagedImages.map((file, idx) => (
                    <div key={`${file.name}-${idx}`} className="relative group w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden border border-white/10">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => removeStagedImage(idx)}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center text-white/80 hover:text-white hover:bg-red-500/80 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  {stagedImages.length < 5 && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg border border-dashed border-white/20 flex items-center justify-center text-white/30 hover:text-white/50 hover:border-white/30 transition-colors"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="flex gap-2 sm:gap-3">
              <button
                onClick={handleAnalyze}
                disabled={loading}
                className="btn-glow flex-1 touch-target text-sm sm:text-base ripple"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2 sm:gap-3">
                    <div className="w-4 h-4 border-2 border-black/20 border-t-black/70 rounded-full animate-spin" />
                    <span className="hidden sm:inline">Analyzing</span>
                    <span className="sm:hidden">...</span>
                  </span>
                ) : stagedImages.length > 0 ? (
                  `Analyze ${stagedImages.length} image${stagedImages.length > 1 ? "s" : ""}`
                ) : (
                  "Analyze"
                )}
              </button>

              <button
                onClick={() => setShowScanner(true)}
                className="btn-glass touch-target tap-highlight"
                aria-label="Scan barcode"
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h2M4 12h2m14 0h2M6 20h2M6 8H4m2 12h2m8 0h2M6 8h2m8 0h2m2 4h2M4 16h2" />
                </svg>
              </button>

              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`btn-glass touch-target tap-highlight ${isRecording ? "recording" : ""}`}
                aria-label={isRecording ? "Stop recording" : "Start recording"}
              >
                {isRecording ? (
                  <svg className="w-5 h-5 sm:w-6 sm:h-6 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </button>

              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-glass touch-target tap-highlight"
                aria-label="Upload image"
              >
                <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </button>

              <input
                ref={fileInputRef}
                id="image-upload-input"
                type="file"
                accept="image/png,image/jpeg"
                multiple
                onChange={handleImageUpload}
                className="hidden"
              />
            </div>

            {error && (
              <div className="mt-4 sm:mt-5 p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-red-500/10 border border-red-500/20">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Hint */}
          {!loading && !result && (
            <div className="mt-8 text-center animate-fade-in" style={{ animationDelay: "0.2s" }}>
              <p className="text-sm text-white/30">
                Type a claim, record your voice, or upload an image
              </p>
            </div>
          )}

          {/* Loading */}
          {loading && <LoadingState onCancel={cancelAnalysis} isUrl={isUrlInput} />}

          {/* Not Relevant Result */}
          {result && result.is_relevant === false && (
            <NotRelevantCard 
              reason={result.rejection_reason} 
              onTryAgain={() => {
                setResult(null);
                setInputText("");
              }}
            />
          )}

          {/* Product Not Found (Barcode) */}
          {productNotFound?.show && (
            <ProductNotFoundCard
              barcode={productNotFound.barcode}
              onManualEntry={handleManualProductEntry}
              onPhotoLabel={() => {
                setProductNotFound(null);
                const fileInput = document.getElementById("image-upload-input") as HTMLInputElement;
                if (fileInput) fileInput.click();
              }}
              onClose={() => {
                setProductNotFound(null);
                setShowScanner(true);
              }}
            />
          )}

          {/* Debug: Show raw result if no card displays */}
          {result && !result.overall_assessment && result.is_relevant !== false && (
            <div className="mt-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
              <p className="text-yellow-400 text-sm font-medium mb-2">Debug: Unexpected response format</p>
              <pre className="text-xs text-white/60 overflow-auto max-h-40">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}

          {/* Results - only show if relevant */}
          {result?.overall_assessment && result.is_relevant !== false && (
            <ResultCard 
              item={result.overall_assessment} 
              inputType={currentInputType} 
              transcript={result?.transcript}
              nutriScore={nutriScore}
              productDetails={productDetails}
            />
          )}

        </div>
      </main>
    </>
  );
}

/* ===========================
   User Details Form
=========================== */

const USER_DETAILS_KEY = "kyf-user-details";

const COUNTRIES = [
  { code: "IN", name: "India" },
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "JP", name: "Japan" },
  { code: "BR", name: "Brazil" },
  { code: "AE", name: "UAE" },
  { code: "SG", name: "Singapore" },
  { code: "MY", name: "Malaysia" },
  { code: "PH", name: "Philippines" },
  { code: "ID", name: "Indonesia" },
  { code: "SA", name: "Saudi Arabia" },
  { code: "NZ", name: "New Zealand" },
  { code: "ZA", name: "South Africa" },
  { code: "NG", name: "Nigeria" },
  { code: "KE", name: "Kenya" },
  { code: "PK", name: "Pakistan" },
  { code: "BD", name: "Bangladesh" },
  { code: "LK", name: "Sri Lanka" },
  { code: "NP", name: "Nepal" },
  { code: "KR", name: "South Korea" },
  { code: "IT", name: "Italy" },
  { code: "ES", name: "Spain" },
  { code: "MX", name: "Mexico" },
  { code: "OTHER", name: "Other" },
];

function guessCountryFromTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "IN";
    if (tz.startsWith("America/New_York") || tz.startsWith("America/Chicago") || tz.startsWith("America/Denver") || tz.startsWith("America/Los_Angeles")) return "US";
    if (tz === "Europe/London") return "GB";
    if (tz.startsWith("Australia/")) return "AU";
    if (tz.startsWith("Asia/Tokyo")) return "JP";
    if (tz.startsWith("Asia/Singapore")) return "SG";
    if (tz.startsWith("Asia/Dubai")) return "AE";
  } catch {}
  return "";
}

function UserDetailsForm({ onComplete }: { onComplete: () => void }) {
  const { user, updateUserProfile } = useAuth();
  const [name, setName] = useState(user?.displayName || "");
  const [age, setAge] = useState("");
  const [country, setCountry] = useState(guessCountryFromTimezone());
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim() || !age || !country) return;
    setSubmitting(true);

    const ageNum = parseInt(age, 10);
    localStorage.setItem("kyf-user-name", name.trim());
    localStorage.setItem("kyf-user-age", String(ageNum));
    localStorage.setItem("kyf-user-country", country);
    localStorage.setItem(USER_DETAILS_KEY, "1");

    if (user) {
      try {
        await updateUserProfile(user.uid, {
          displayName: name.trim(),
          age: ageNum,
          country,
        });
      } catch (e) {
        console.error("Error saving profile:", e);
      }
    }

    setSubmitting(false);
    onComplete();
  };

  const isValid = name.trim().length > 0 && age && parseInt(age, 10) > 0 && parseInt(age, 10) < 120 && country;

  return (
    <>
      <AnimatedBackground />
      <div className="min-h-screen min-h-dvh flex items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full animate-card-enter">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 border border-white/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-1">Tell us about you</h2>
            <p className="text-sm text-white/40">This helps us personalize your experience</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="glass-input text-sm"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Age</label>
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="Your age"
                min="1"
                max="119"
                className="glass-input text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5 ml-1">Country</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="glass-input text-sm appearance-none"
              >
                <option value="" disabled>Select your country</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="w-full mt-6 py-3.5 rounded-xl bg-white/90 text-black font-medium text-sm tap-highlight hover:bg-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Saving..." : "Get Started"}
          </button>

          <p className="text-[11px] text-white/25 mt-4 text-center">
            Your info is stored securely and never shared
          </p>
        </div>
      </div>
    </>
  );
}

/* ===========================
   Welcome Screen
=========================== */

const WELCOME_KEY = "kyf-welcomed";

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  const { signInWithGoogle, firebaseReady } = useAuth();

  const handleSignIn = async () => {
    await signInWithGoogle();
    localStorage.setItem(WELCOME_KEY, "1");
    onContinue();
  };

  const handleGuest = () => {
    localStorage.setItem(WELCOME_KEY, "1");
    onContinue();
  };

  return (
    <>
      <AnimatedBackground />
      <div className="min-h-screen min-h-dvh flex items-center justify-center px-6 py-12">
        <div className="max-w-sm w-full text-center animate-card-enter">

          <div className="w-20 h-20 mx-auto mb-6 rounded-3xl overflow-hidden shadow-lg shadow-indigo-500/20">
            <img src="/icons/icon.svg" alt="Know Your Food" className="w-full h-full" />
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold mb-3 animate-header-gradient">
            Know Your Food
          </h1>
          <p className="text-sm sm:text-base text-white/50 mb-8 leading-relaxed">
            AI-powered analysis of health, nutrition &amp; fitness claims — backed by science.
          </p>

          <div className="space-y-3">
            {firebaseReady && (
              <button
                onClick={handleSignIn}
                className="w-full py-3.5 rounded-xl bg-white/90 text-black font-medium text-sm flex items-center justify-center gap-2.5 tap-highlight hover:bg-white transition-colors"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>
            )}

            <button
              onClick={handleGuest}
              className="w-full py-3.5 rounded-xl bg-white/[0.08] border border-white/[0.1] text-white/70 font-medium text-sm tap-highlight hover:bg-white/[0.12] transition-colors"
            >
              Continue as Guest
            </button>
          </div>

          <p className="text-[11px] text-white/25 mt-6">
            {firebaseReady
              ? `Sign in to save history and get ${SIGNUP_BONUS} free credits`
              : "3 free analyses per day"}
          </p>
        </div>
      </div>
    </>
  );
}

export default function Home() {
  const [welcomed, setWelcomed] = useState<boolean | null>(null);
  const [detailsCollected, setDetailsCollected] = useState<boolean | null>(null);
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    const stored = localStorage.getItem(WELCOME_KEY);
    const details = localStorage.getItem(USER_DETAILS_KEY);
    setWelcomed(!!stored);
    setDetailsCollected(!!details);
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem(WELCOME_KEY, "1");
      setWelcomed(true);
    }
  }, [user]);

  if (welcomed === null || detailsCollected === null || authLoading) return null;

  if (!welcomed) {
    return (
      <ErrorBoundary>
        <WelcomeScreen onContinue={() => setWelcomed(true)} />
      </ErrorBoundary>
    );
  }

  if (!detailsCollected) {
    return (
      <ErrorBoundary>
        <UserDetailsForm onComplete={() => setDetailsCollected(true)} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <HomeContent />
    </ErrorBoundary>
  );
}
