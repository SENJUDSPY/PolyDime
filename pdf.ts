import React, { useState, useEffect } from 'react';
import { Book, getBook, saveBook, updateBookProgress, BookmarkPin, Highlight, StickyNote } from '../lib/db';
import { loadPdf, renderPdfPage, extractPdfText, getPdfTextContent } from '../lib/pdf';
import * as pdfjsLib from 'pdfjs-dist';
import { BookFlip } from './BookFlip';
import { ArrowLeft, Moon, Sun, ZoomIn, ZoomOut, MessageSquare, Loader2, Maximize2, Minimize2, Settings2, Type, AlignLeft, Paperclip, RotateCcw, RotateCw, Highlighter, X, StickyNote as StickyNoteIcon, Sparkles } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { motion, AnimatePresence, useMotionValue, useMotionTemplate } from 'framer-motion';
import { cn } from '../lib/utils';
import { v4 as uuidv4 } from 'uuid';

const PIN_COLORS = ['#606C38', '#283618', '#FEFAE0', '#DDA15E', '#BC6C25', '#8c4a4a'];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const Reader = ({ bookId, onBack }: { bookId: string; onBack: () => void }) => {
  const [book, setBook] = useState<Book | null>(null);
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pdfAspectRatio, setPdfAspectRatio] = useState<number>(1 / 1.4); // Default aspect ratio
  const [currentPage, setCurrentPage] = useState(0);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [zoom, setZoom] = useState(1);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'ai' | 'bookmarks' | 'highlights'>('ai');
  const [aiQuery, setAiQuery] = useState('');
  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showToolbar, setShowToolbar] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // New Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [isTextMode, setIsTextMode] = useState(false);
  const [fontSize, setFontSize] = useState(18);
  const [lineSpacing, setLineSpacing] = useState(1.6);
  const [brightness, setBrightness] = useState(100);
  const [pageTexts, setPageTexts] = useState<Record<number, string>>({});
  const [pageTextContent, setPageTextContent] = useState<Record<number, any>>({});
  const [selectionMenu, setSelectionMenu] = useState<{ x: number, y: number, text: string } | null>(null);

  // Bookmark Pins State
  const [isTrayOpen, setIsTrayOpen] = useState(false);
  const [selectedPinColor, setSelectedPinColor] = useState<string | null>(null);
  const [trayRotation, setTrayRotation] = useState(0);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Highlighter State
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState('#DDA15E'); // Default Earth Yellow

  // Sticky Note State
  const [isStickyMode, setIsStickyMode] = useState(false);
  const [stickyColor, setStickyColor] = useState('#DDA15E');
  const [activeStickyId, setActiveStickyId] = useState<string | null>(null);

  const [drawingHighlight, setDrawingHighlight] = useState<{
    page: number;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  const pinTransform = useMotionTemplate`translate(calc(${mouseX}px - 10px), calc(${mouseY}px - 10px)) rotate(15deg)`;
  const stickyTransform = useMotionTemplate`translate(calc(${mouseX}px - 10px), calc(${mouseY}px - 10px))`;
  const highlightTransform = useMotionTemplate`translate(${mouseX}px, ${mouseY}px)`;

  useEffect(() => {
    if (!selectedPinColor && !isHighlightMode && !isStickyMode) return;
    const handleMouseMove = (e: MouseEvent) => {
      mouseX.set(e.clientX);
      mouseY.set(e.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [selectedPinColor, isHighlightMode, isStickyMode, mouseX, mouseY]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPinColor(null);
        setIsTrayOpen(false);
        setIsHighlightMode(false);
        setIsStickyMode(false);
        setDrawingHighlight(null);
        setActiveStickyId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const handleMouseMove = () => {
      setShowToolbar(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!aiPanelOpen && !showSettings) setShowToolbar(false);
      }, 3000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(timeout);
    };
  }, [aiPanelOpen, showSettings]);

  useEffect(() => {
    const handleMouseUp = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setSelectionMenu({
          x: rect.left + rect.width / 2,
          y: rect.top,
          text: selection.toString().trim()
        });
      } else {
        setSelectionMenu(null);
      }
    };

    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  useEffect(() => {
    const init = async () => {
      const b = await getBook(bookId);
      if (b) {
        setBook(b);
        setCurrentPage(b.currentPage);
        if (b.fileData) {
          const pdf = await loadPdf(b.fileData);
          setPdfDoc(pdf);
          
          try {
            const firstPage = await pdf.getPage(1);
            const viewport = firstPage.getViewport({ scale: 1 });
            setPdfAspectRatio(viewport.width / viewport.height);
          } catch (e) {
            console.error('Failed to get aspect ratio', e);
          }
        } else {
          alert('This book was uploaded on another device. Please re-upload the PDF to read it here.');
          onBack();
        }
      }
    };
    init();
  }, [bookId]);

  useEffect(() => {
    if (!pdfDoc || !book) return;
    
    // Preload current, previous, and next pages
    const pagesToLoad = [
      currentPage - 2, currentPage - 1, 
      currentPage, currentPage + 1, 
      currentPage + 2, currentPage + 3
    ].filter(p => p >= 0 && p < book.totalPages);

    pagesToLoad.forEach(async (p) => {
      // Load Images
      if (!pageImages[p]) {
        try {
          // PDF pages are 1-indexed
          const imgUrl = await renderPdfPage(pdfDoc, p + 1, book.id);
          setPageImages(prev => ({ ...prev, [p]: imgUrl }));
        } catch (e) {
          console.error('Failed to render page', p, e);
        }
      }
      
      // Load Text for Text Mode
      if (isTextMode && !pageTexts[p]) {
        try {
          const text = await extractPdfText(pdfDoc, p + 1);
          setPageTexts(prev => ({ ...prev, [p]: text }));
        } catch (e) {
          console.error('Failed to extract text', p, e);
        }
      }

      // Load Text Content for Highlighting
      if (!pageTextContent[p]) {
        try {
          const content = await getPdfTextContent(pdfDoc, p + 1);
          setPageTextContent(prev => ({ ...prev, [p]: content }));
        } catch (e) {
          console.error('Failed to get text content', p, e);
        }
      }
    });
  }, [currentPage, pdfDoc, book, pageImages, pageTexts, pageTextContent, isTextMode]);

  const handlePageChange = async (newPage: number) => {
    setCurrentPage(newPage);
    if (book) {
      const now = Date.now();
      const updatedBook = { ...book, currentPage: newPage, lastOpened: now };
      setBook(updatedBook);
      try {
        await updateBookProgress(book.id, newPage, now);
      } catch (err) {
        console.error('Failed to update book progress:', err);
      }
    }
  };

  // Auto-save progress periodically in the background
  useEffect(() => {
    if (!book) return;

    const intervalId = setInterval(() => {
      const now = Date.now();
      setBook(prev => prev ? { ...prev, lastOpened: now } : prev);
      updateBookProgress(book.id, currentPage, now).catch(err => {
        console.error('Failed to auto-save progress:', err);
      });
    }, 30000); // Auto-save every 30 seconds

    return () => clearInterval(intervalId);
  }, [book?.id, currentPage]);

  const handleAskAi = async (queryOverride?: string) => {
    const queryToUse = queryOverride || aiQuery;
    if (!queryToUse.trim() || !pdfDoc) return;
    setIsAiLoading(true);
    setAiResponse('');
    
    try {
      // Extract text from current visible pages
      const leftText = currentPage - 1 >= 0 ? await extractPdfText(pdfDoc, currentPage) : '';
      const rightText = currentPage < book!.totalPages ? await extractPdfText(pdfDoc, currentPage + 1) : '';
      const contextText = `${leftText}\n\n${rightText}`;

      const prompt = `Context from the current pages of the book:\n"""\n${contextText}\n"""\n\nUser Question: ${queryToUse}\n\nPlease answer the user's question based on the context provided. If the answer is not in the context, say so.`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: prompt,
      });

      setAiResponse(response.text || 'No response generated.');
    } catch (error) {
      console.error('AI Error:', error);
      setAiResponse('Sorry, there was an error processing your request.');
    } finally {
      setIsAiLoading(false);
    }
  };

  if (!book || !pdfDoc) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  const renderPage = (index: number) => {
    if (index < 0 || index >= book.totalPages) return null;
    
    const handlePageClick = (e: React.MouseEvent) => {
      if (!book) return;
      
      if (isStickyMode) {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        const newSticky: StickyNote = {
          id: uuidv4(),
          page: index,
          x,
          y,
          text: '',
          color: stickyColor
        };

        const updatedBook = {
          ...book,
          stickyNotes: [...(book.stickyNotes || []), newSticky]
        };

        setBook(updatedBook);
        saveBook(updatedBook);
        setActiveStickyId(newSticky.id);
        setIsStickyMode(false); // Turn off sticky mode after placing one
        return;
      }

      if (!selectedPinColor) return;
      e.stopPropagation();

      const rect = e.currentTarget.getBoundingClientRect();
      let x = ((e.clientX - rect.left) / rect.width) * 100;
      let y = ((e.clientY - rect.top) / rect.height) * 100;

      // Snap to edges if close (within 10%)
      const threshold = 10;
      if (x < threshold) x = 0;
      else if (x > 100 - threshold) x = 100;
      
      if (y < threshold) y = 0;
      else if (y > 100 - threshold) y = 100;

      const newPin: BookmarkPin = {
        id: uuidv4(),
        page: index,
        x,
        y,
        color: selectedPinColor
      };

      const updatedBook = {
        ...book,
        pins: [...(book.pins || []), newPin]
      };

      setBook(updatedBook);
      saveBook(updatedBook);
    };

    const handleTextSelection = (e: React.MouseEvent) => {
      if (!isHighlightMode || !book) return;
      
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return;

      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      const containerRect = e.currentTarget.getBoundingClientRect();

      const newHighlights: Highlight[] = [];

      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        const x = ((rect.left - containerRect.left) / containerRect.width) * 100;
        const y = ((rect.top - containerRect.top) / containerRect.height) * 100;
        const width = (rect.width / containerRect.width) * 100;
        const height = (rect.height / containerRect.height) * 100;

        if (width > 0.1 && height > 0.1) {
          newHighlights.push({
            id: uuidv4(),
            page: index,
            x,
            y,
            width,
            height,
            color: highlightColor
          });
        }
      }

      if (newHighlights.length > 0) {
        const updatedBook = {
          ...book,
          highlights: [...(book.highlights || []), ...newHighlights]
        };
        setBook(updatedBook);
        saveBook(updatedBook);
        selection.removeAllRanges();
      }
    };

    const pagePins = (book.pins || []).filter(p => p.page === index);
    const pageHighlights = (book.highlights || []).filter(h => h.page === index);
    const pageStickyNotes = (book.stickyNotes || []).filter(s => s.page === index);
    const imgUrl = pageImages[index];

    return (
      <div 
        className={`w-full h-full relative overflow-hidden ${theme === 'dark' ? 'bg-foreground' : 'bg-background'} ${selectedPinColor ? 'cursor-crosshair' : ''} ${isHighlightMode ? 'cursor-text' : ''} ${isStickyMode ? 'cursor-crosshair' : ''}`}
        onClick={handlePageClick}
      >
        {isTextMode ? (
          <div 
            className={`w-full h-full p-8 sm:p-12 overflow-y-auto ${theme === 'dark' ? 'bg-foreground text-background' : 'bg-background text-foreground'}`}
            style={{ 
              fontSize: `${fontSize}px`, 
              lineHeight: lineSpacing,
              fontFamily: 'var(--font-serif)'
            }}
          >
            {pageTexts[index] !== undefined ? (
              <div className="whitespace-pre-wrap pb-12">{pageTexts[index]}</div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-surface/40 animate-spin" />
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center p-4">
            {imgUrl ? (
              <div className="relative max-w-full max-h-full" style={{ aspectRatio: pdfAspectRatio }}>
                <img 
                  src={imgUrl} 
                  alt={`Page ${index + 1}`} 
                  className={`w-full h-full object-contain pointer-events-none select-none ${theme === 'dark' ? 'invert hue-rotate-180' : ''}`}
                  style={{ transform: `scale(${zoom})`, transition: 'transform 0.3s ease' }}
                />
                
                {/* Text Layer for Selection */}
                {pageTextContent[index] && (
                  <div 
                    className={cn(
                      "absolute inset-0 z-30 transition-opacity",
                      isHighlightMode ? "select-text cursor-text opacity-100" : "pointer-events-none select-none opacity-0"
                    )}
                    onMouseUp={handleTextSelection}
                    style={{ transform: `scale(${zoom})`, transition: 'transform 0.3s ease' }}
                  >
                    {pageTextContent[index].items.map((item: any, i: number) => {
                      const { transform, width, height, str } = item;
                      const { width: pageWidth, height: pageHeight } = pageTextContent[index].viewport;
                      
                      // transform is [scaleX, skewY, skewX, scaleY, translateX, translateY]
                      const left = (transform[4] / pageWidth) * 100;
                      const bottom = (transform[5] / pageHeight) * 100;
                      const fontSize = transform[0]; // Approximate
                      const itemWidth = (width / pageWidth) * 100;
                      const itemHeight = (height / pageHeight) * 100;

                      return (
                        <span
                          key={i}
                          className="absolute whitespace-pre"
                          style={{
                            left: `${left}%`,
                            bottom: `${bottom}%`,
                            fontSize: `${fontSize}px`,
                            width: `${itemWidth}%`,
                            height: `${itemHeight}%`,
                            transform: `scaleY(-1)`, // PDF coordinates are bottom-up
                            transformOrigin: 'bottom left',
                            color: 'transparent',
                          }}
                        >
                          {str}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <Loader2 className="w-8 h-8 text-surface/40 animate-spin" />
            )}
          </div>
        )}

        <div className={`absolute bottom-4 left-0 right-0 flex items-center justify-between px-10 text-[10px] font-mono pointer-events-none ${theme === 'dark' ? 'text-surface/60' : 'text-surface'}`}>
          <span className="truncate max-w-[150px] opacity-40 uppercase tracking-[0.2em] font-sans">{book.title}</span>
          <span className="opacity-60 font-sans">{index + 1}</span>
        </div>

        {/* Render Highlights */}
        {pageHighlights.map(highlight => (
          <div
            key={highlight.id}
            className="absolute mix-blend-multiply group z-40"
            style={{ 
              left: `${highlight.x}%`, 
              top: `${highlight.y}%`, 
              width: `${highlight.width}%`, 
              height: `${highlight.height}%`, 
              backgroundColor: highlight.color,
              opacity: 0.4,
              borderRadius: '2px',
              boxShadow: `0 0 5px ${highlight.color}40`,
              transform: 'rotate(-0.2deg)' // Slight rotation for organic feel
            }}
          >
            <button
              className="absolute -top-6 right-0 bg-red-500 text-zinc-50 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                const updatedBook = { ...book, highlights: book.highlights!.filter(h => h.id !== highlight.id) };
                setBook(updatedBook);
                saveBook(updatedBook);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Render Drawing Highlight */}
        {drawingHighlight && drawingHighlight.page === index && (
          <div
            className="absolute mix-blend-multiply pointer-events-none z-40"
            style={{ 
              left: `${Math.min(drawingHighlight.startX, drawingHighlight.currentX)}%`, 
              top: `${Math.min(drawingHighlight.startY, drawingHighlight.currentY)}%`, 
              width: `${Math.abs(drawingHighlight.currentX - drawingHighlight.startX)}%`, 
              height: `${Math.abs(drawingHighlight.currentY - drawingHighlight.startY)}%`, 
              backgroundColor: highlightColor,
              opacity: 0.4
            }}
          />
        )}

        {/* Render Pins */}
        {pagePins.map(pin => {
          const isAtLeft = pin.x === 0;
          const isAtRight = pin.x === 100;
          const isAtTop = pin.y === 0;
          const isAtBottom = pin.y === 100;
          const isOnEdge = isAtLeft || isAtRight || isAtTop || isAtBottom;

          return (
            <div
              key={pin.id}
              className={cn(
                "absolute z-50 cursor-pointer hover:scale-110 transition-transform group",
                !isOnEdge && "hover:rotate-12"
              )}
              style={{ 
                left: `${pin.x}%`, 
                top: `${pin.y}%`, 
                transform: isAtLeft ? 'translate(-30%, -50%) rotate(-90deg)' :
                           isAtRight ? 'translate(-70%, -50%) rotate(90deg)' :
                           isAtTop ? 'translate(-50%, -30%) rotate(0deg)' :
                           isAtBottom ? 'translate(-50%, -70%) rotate(180deg)' :
                           'translate(-50%, -50%) rotate(15deg)'
              }}
              onClick={(e) => {
                e.stopPropagation();
                const updatedBook = { ...book, pins: book.pins!.filter(p => p.id !== pin.id) };
                setBook(updatedBook);
                saveBook(updatedBook);
              }}
            >
              <div className="relative">
                <Paperclip 
                  className={cn(
                    "w-8 h-8 drop-shadow-lg",
                    isOnEdge ? "opacity-100" : "opacity-90"
                  )} 
                  style={{ color: pin.color }} 
                />
                {/* Physical paperclip detail */}
                <div 
                  className="absolute inset-0 border-2 border-zinc-50/20 rounded-full pointer-events-none" 
                  style={{ opacity: 0.3 }}
                />
              </div>
              <div className={cn(
                "absolute bg-red-500 text-zinc-50 text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-[60]",
                isAtTop ? "top-full mt-2 left-1/2 -translate-x-1/2" :
                isAtBottom ? "bottom-full mb-2 left-1/2 -translate-x-1/2" :
                isAtLeft ? "left-full ml-2 top-1/2 -translate-y-1/2" :
                "right-full mr-2 top-1/2 -translate-y-1/2"
              )}>
                Remove Pin
              </div>
            </div>
          );
        })}

        {/* Render Sticky Notes */}
        {pageStickyNotes.map(sticky => (
          <div
            key={sticky.id}
            className="absolute z-50 group"
            style={{ left: `${sticky.x}%`, top: `${sticky.y}%` }}
            onClick={(e) => e.stopPropagation()}
          >
            <div 
              className="relative cursor-pointer hover:scale-110 transition-transform"
              onClick={() => setActiveStickyId(activeStickyId === sticky.id ? null : sticky.id)}
            >
              <StickyNoteIcon className="w-8 h-8 drop-shadow-md" style={{ color: sticky.color, fill: sticky.color }} />
              <button
                className="absolute -top-2 -right-2 bg-red-500 text-zinc-50 p-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => {
                  e.stopPropagation();
                  const updatedBook = { ...book, stickyNotes: book.stickyNotes!.filter(s => s.id !== sticky.id) };
                  setBook(updatedBook);
                  saveBook(updatedBook);
                  if (activeStickyId === sticky.id) setActiveStickyId(null);
                }}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            
            <AnimatePresence>
              {activeStickyId === sticky.id && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 10 }}
                  className="absolute top-full left-0 mt-2 w-64 p-3 rounded-lg shadow-xl border border-zinc-200/20 backdrop-blur-md"
                  style={{ backgroundColor: `${sticky.color}dd` }}
                >
                  <textarea
                    autoFocus
                    className="w-full h-32 bg-transparent border-none resize-none focus:outline-none text-zinc-900 placeholder:text-zinc-900/50"
                    placeholder="Type your note here..."
                    value={sticky.text}
                    onChange={(e) => {
                      const updatedNotes = book.stickyNotes!.map(s => 
                        s.id === sticky.id ? { ...s, text: e.target.value } : s
                      );
                      const updatedBook = { ...book, stickyNotes: updatedNotes };
                      setBook(updatedBook);
                      saveBook(updatedBook);
                    }}
                  />
                  <div className="flex justify-end mt-2">
                    <button
                      onClick={() => {
                        const query = `Explain this note: ${sticky.text}`;
                        setAiQuery(query);
                        setAiPanelOpen(true);
                        handleAskAi(query);
                      }}
                      className="text-xs bg-zinc-50/30 hover:bg-zinc-50/50 text-zinc-900 px-2 py-1 rounded flex items-center gap-1 transition-colors"
                    >
                      <Sparkles className="w-3 h-3" /> Explain
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`min-h-screen flex flex-col transition-colors duration-700 ${theme === 'dark' ? 'bg-foreground text-background' : 'bg-background text-foreground'}`}
    >
      {/* Toolbar */}
      <AnimatePresence>
        {showToolbar && (
          <motion.header 
            initial={{ y: -100 }}
            animate={{ y: 0 }}
            exit={{ y: -100 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={`h-16 px-6 flex items-center justify-between border-b ${theme === 'dark' ? 'border-background/5 bg-foreground/40' : 'border-foreground/5 bg-background/40'} backdrop-blur-xl fixed top-0 left-0 right-0 z-50`}
          >
            <div className="flex items-center gap-4">
              <button onClick={onBack} className={`p-2.5 rounded-full transition-all active:scale-95 ${theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="font-serif font-medium truncate max-w-xs text-base tracking-wide">{book.title}</h1>
            </div>
            
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button onClick={() => setShowSettings(!showSettings)} className={`p-2.5 rounded-full transition-all active:scale-95 ${showSettings ? 'bg-primary text-background shadow-lg shadow-primary/20' : theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                  <Settings2 className="w-4 h-4" />
                </button>
                
                <AnimatePresence>
                  {showSettings && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className={`absolute top-full right-0 mt-4 w-72 p-5 rounded-2xl shadow-2xl border ${theme === 'dark' ? 'bg-foreground border-background/10' : 'bg-background border-foreground/5'} backdrop-blur-xl z-50 flex flex-col gap-6`}
                    >
                      {/* Text Mode Toggle */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium font-sans uppercase tracking-wider">Reader Mode</span>
                        <button 
                          onClick={() => setIsTextMode(!isTextMode)}
                          className={`w-12 h-6 rounded-full transition-colors relative ${isTextMode ? 'bg-primary' : 'bg-surface/30'}`}
                        >
                          <div className={`w-4 h-4 rounded-full bg-background absolute top-1 transition-all ${isTextMode ? 'left-7' : 'left-1'}`} />
                        </button>
                      </div>

                      {/* Brightness Slider */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-surface font-sans uppercase tracking-wider">
                          <span className="flex items-center gap-1.5"><Sun className="w-3.5 h-3.5" /> Brightness</span>
                          <span>{brightness}%</span>
                        </div>
                        <input 
                          type="range" 
                          min="50" max="150" 
                          value={brightness} 
                          onChange={e => setBrightness(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>

                      {/* Font Size Slider */}
                      <div className={`space-y-3 transition-opacity ${!isTextMode ? 'opacity-40 pointer-events-none' : ''}`}>
                        <div className="flex items-center justify-between text-xs text-surface font-sans uppercase tracking-wider">
                          <span className="flex items-center gap-1.5"><Type className="w-3.5 h-3.5" /> Font Size</span>
                          <span>{fontSize}px</span>
                        </div>
                        <input 
                          type="range" 
                          min="12" max="32" 
                          value={fontSize} 
                          onChange={e => setFontSize(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>

                      {/* Line Spacing Slider */}
                      <div className={`space-y-3 transition-opacity ${!isTextMode ? 'opacity-40 pointer-events-none' : ''}`}>
                        <div className="flex items-center justify-between text-xs text-surface font-sans uppercase tracking-wider">
                          <span className="flex items-center gap-1.5"><AlignLeft className="w-3.5 h-3.5" /> Line Spacing</span>
                          <span>{lineSpacing}x</span>
                        </div>
                        <input 
                          type="range" 
                          min="1" max="2.5" step="0.1"
                          value={lineSpacing} 
                          onChange={e => setLineSpacing(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className={`w-px h-4 mx-2 ${theme === 'dark' ? 'bg-background/10' : 'bg-foreground/10'}`} />

              <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} disabled={isTextMode} className={`p-2.5 rounded-full transition-all active:scale-95 disabled:opacity-30 ${theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className={`text-xs font-sans w-12 text-center opacity-70 ${isTextMode ? 'opacity-30' : ''}`}>{Math.round(zoom * 100)}%</span>
              <button onClick={() => setZoom(z => Math.min(2, z + 0.1))} disabled={isTextMode} className={`p-2.5 rounded-full transition-all active:scale-95 disabled:opacity-30 ${theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className={`w-px h-4 mx-2 ${theme === 'dark' ? 'bg-background/10' : 'bg-foreground/10'}`} />
              <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className={`p-2.5 rounded-full transition-all active:scale-95 ${theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
              <button onClick={toggleFullscreen} className={`p-2.5 rounded-full transition-all active:scale-95 ${theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button onClick={() => setAiPanelOpen(!aiPanelOpen)} className={`p-2.5 rounded-full transition-all active:scale-95 ml-2 ${aiPanelOpen ? 'bg-primary text-background shadow-lg shadow-primary/20' : theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}>
                <MessageSquare className="w-4 h-4" />
              </button>
              <button 
                onClick={() => {
                  setIsHighlightMode(!isHighlightMode);
                  if (!isHighlightMode) {
                    setSelectedPinColor(null);
                    setIsTrayOpen(false);
                    setIsStickyMode(false);
                  }
                }} 
                className={`p-2.5 rounded-full transition-all active:scale-95 ${isHighlightMode ? 'bg-primary text-background shadow-lg shadow-primary/20' : theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}
              >
                <Highlighter className="w-4 h-4" />
              </button>
              <button 
                onClick={() => {
                  setIsStickyMode(!isStickyMode);
                  if (!isStickyMode) {
                    setSelectedPinColor(null);
                    setIsTrayOpen(false);
                    setIsHighlightMode(false);
                  }
                }} 
                className={`p-2.5 rounded-full transition-all active:scale-95 ${isStickyMode ? 'bg-primary text-background shadow-lg shadow-primary/20' : theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}
              >
                <StickyNoteIcon className="w-4 h-4" />
              </button>

              {/* Color Selection for Active Tool */}
              {(isStickyMode || isHighlightMode) && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-1.5 ml-2 px-2 py-1 bg-surface/10 rounded-full border border-surface/10"
                >
                  {PIN_COLORS.map(color => (
                    <button
                      key={color}
                      onClick={() => isStickyMode ? setStickyColor(color) : setHighlightColor(color)}
                      className={cn(
                        "w-4 h-4 rounded-full border border-background/20 transition-transform hover:scale-125",
                        (isStickyMode ? stickyColor === color : highlightColor === color) && "ring-2 ring-primary ring-offset-2 ring-offset-foreground"
                      )}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </motion.div>
              )}

              <button 
                onClick={() => {
                  setIsTrayOpen(!isTrayOpen);
                  if (!isTrayOpen) {
                    setIsHighlightMode(false);
                    setIsStickyMode(false);
                  }
                  if (isTrayOpen) setSelectedPinColor(null);
                }} 
                className={`p-2.5 rounded-full transition-all active:scale-95 ${isTrayOpen || selectedPinColor ? 'bg-primary text-background shadow-lg shadow-primary/20' : theme === 'dark' ? 'hover:bg-background/10' : 'hover:bg-foreground/5'}`}
              >
                <Paperclip className="w-4 h-4" />
              </button>
            </div>
          </motion.header>
        )}
      </AnimatePresence>

      {/* Floating Pin Cursor */}
      {selectedPinColor && (
        <motion.div
          className="fixed pointer-events-none z-[100] drop-shadow-2xl"
          style={{ left: 0, top: 0, transform: pinTransform }}
        >
          <Paperclip className="w-8 h-8" style={{ color: selectedPinColor }} />
          <div className="absolute top-8 left-8 bg-foreground/70 text-background text-[10px] px-2 py-1 rounded-full whitespace-nowrap font-sans uppercase tracking-wider">
            Click to place • Esc to cancel
          </div>
        </motion.div>
      )}

      {/* Floating Sticky Note Cursor */}
      {isStickyMode && (
        <motion.div
          className="fixed pointer-events-none z-[100] drop-shadow-2xl"
          style={{ left: 0, top: 0, transform: stickyTransform }}
        >
          <StickyNoteIcon className="w-8 h-8" style={{ color: stickyColor, fill: stickyColor }} />
          <div className="absolute top-8 left-8 bg-foreground/70 text-background text-[10px] px-2 py-1 rounded-full whitespace-nowrap font-sans uppercase tracking-wider">
            Click to place • Esc to cancel
          </div>
        </motion.div>
      )}

      {/* Floating Highlighter Cursor */}
      {isHighlightMode && (
        <motion.div
          className="fixed pointer-events-none z-[100]"
          style={{ left: 0, top: 0, transform: highlightTransform }}
        >
          {/* 3D Pen Body */}
          <div 
            className="absolute w-6 h-32"
            style={{ 
              left: '-12px', 
              bottom: '0px', 
              transformOrigin: 'bottom center', 
              transform: 'rotate(-15deg)' 
            }}
          >
            {/* Pen Tip */}
            <div 
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-6"
              style={{ backgroundColor: highlightColor, clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}
            />
            {/* Pen Grip */}
            <div className="absolute bottom-6 left-0 w-full h-8 bg-foreground rounded-sm shadow-lg" />
            {/* Pen Body */}
            <div className="absolute bottom-14 left-0 w-full h-16 bg-surface rounded-t-full shadow-xl" />
            {/* Pen Cap/Top */}
            <div className="absolute bottom-30 left-1/2 -translate-x-1/2 w-4 h-2 bg-surface/80 rounded-full" />
            
            {/* Glow effect */}
            <div 
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full blur-xl opacity-50"
              style={{ backgroundColor: highlightColor }}
            />
          </div>
          <div className="absolute top-4 left-4 bg-foreground/70 text-background text-[10px] px-2 py-1 rounded-full whitespace-nowrap font-sans uppercase tracking-wider">
            Select text to highlight • Esc to cancel
          </div>
        </motion.div>
      )}

      {/* Bookmark Tray */}
      <AnimatePresence>
        {isTrayOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.9 }}
            className="absolute top-20 right-8 z-50 flex flex-col items-center gap-4"
          >
            <div
              className="relative w-64 h-64 rounded-full bg-background/60 backdrop-blur-2xl border border-surface/50 shadow-2xl overflow-hidden shadow-foreground/20"
              onWheel={(e) => setTrayRotation(r => r + (e.deltaY > 0 ? 60 : -60))}
            >
              {/* Center Label */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 bg-background rounded-full z-20 shadow-inner flex items-center justify-center text-center p-2 border border-surface/10">
                <span className="text-[9px] font-bold text-surface uppercase tracking-widest leading-tight font-sans">Stationery<br/>Set</span>
              </div>

              {/* Rotating Container */}
              <motion.div
                className="w-full h-full rounded-full relative"
                animate={{ rotate: trayRotation }}
                transition={{ type: "spring", stiffness: 50, damping: 20 }}
              >
                {PIN_COLORS.map((color, i) => {
                  const angle = i * 60;
                  return (
                    <div
                      key={color}
                      className="absolute top-1/2 left-1/2 w-32 h-32 origin-top-left"
                      style={{
                        transform: `rotate(${angle}deg)`,
                      }}
                    >
                      {/* Divider */}
                      <div className="absolute top-0 left-0 w-full h-px bg-foreground/5" />
                      {/* Pins */}
                      <div
                        className="absolute top-8 left-8 w-16 h-16 cursor-pointer hover:scale-110 transition-transform flex items-center justify-center"
                        style={{ transform: `rotate(-${angle + trayRotation}deg)` }}
                        onClick={() => setSelectedPinColor(color)}
                      >
                        <Paperclip className="absolute w-6 h-6 drop-shadow-md -translate-x-2 -translate-y-2 rotate-12" style={{ color }} />
                        <Paperclip className="absolute w-6 h-6 drop-shadow-md translate-x-2 -translate-y-1 -rotate-45" style={{ color }} />
                        <Paperclip className="absolute w-6 h-6 drop-shadow-md translate-y-2 rotate-90" style={{ color }} />
                      </div>
                    </div>
                  );
                })}
              </motion.div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4 bg-background/80 backdrop-blur-md px-4 py-2 rounded-full shadow-lg border border-surface/50">
              <button onClick={() => setTrayRotation(r => r - 60)} className="p-2 hover:bg-foreground/5 rounded-full text-foreground"><RotateCcw className="w-4 h-4" /></button>
              <span className="text-xs font-medium text-surface select-none font-sans uppercase tracking-wider">Scroll to rotate</span>
              <button onClick={() => setTrayRotation(r => r + 60)} className="p-2 hover:bg-foreground/5 rounded-full text-foreground"><RotateCw className="w-4 h-4" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main 
        className="flex-1 flex overflow-hidden relative w-full h-full"
        style={{ filter: `brightness(${brightness}%)`, transition: 'filter 0.3s ease' }}
      >
        <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 overflow-hidden relative">
          <BookFlip 
            totalPages={book.totalPages}
            currentPage={currentPage}
            onPageChange={handlePageChange}
            renderPage={renderPage}
            aspectRatio={pdfAspectRatio}
            isPlacingPin={!!selectedPinColor}
          />
          
          {/* Progress Bar - Immersive */}
          <AnimatePresence>
            {showToolbar && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md flex items-center gap-4 px-6 py-3 rounded-full backdrop-blur-xl bg-foreground/20 border border-background/10 shadow-2xl"
              >
                <span className="text-xs font-sans text-background/70 w-8 text-right">{Math.max(1, currentPage)}</span>
                <div 
                  className="flex-1 h-3 bg-background/20 rounded-full overflow-hidden cursor-pointer relative group"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percentage = x / rect.width;
                    const targetPage = Math.max(1, Math.min(book.totalPages, Math.ceil(percentage * book.totalPages)));
                    handlePageChange(targetPage);
                  }}
                >
                  <div 
                    className="absolute top-0 left-0 h-full bg-primary transition-all duration-300 ease-out"
                    style={{ width: `${(Math.max(1, currentPage) / book.totalPages) * 100}%` }}
                  />
                  <div className="absolute top-0 left-0 w-full h-full bg-background/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <span className="text-xs font-sans text-background/70 w-8">{book.totalPages}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* AI Sidebar */}
        <AnimatePresence>
          {aiPanelOpen && (
            <motion.div 
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className={`w-80 border-l flex flex-col z-40 ${theme === 'dark' ? 'border-background/10 bg-foreground/95' : 'border-foreground/5 bg-background/95'} backdrop-blur-2xl shadow-2xl absolute right-0 top-0 bottom-0 pt-16`}
            >
              <div className={`p-5 border-b ${theme === 'dark' ? 'border-background/5' : 'border-foreground/5'} flex items-center gap-4`}>
                <button 
                  onClick={() => setSidebarTab('ai')}
                  className={cn(
                    "pb-2 text-xs font-medium transition-all relative font-sans uppercase tracking-wider",
                    sidebarTab === 'ai' ? "text-primary" : "text-surface hover:text-foreground"
                  )}
                >
                  Flipverse AI
                  {sidebarTab === 'ai' && <motion.div layoutId="sidebarTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
                <button 
                  onClick={() => setSidebarTab('highlights')}
                  className={cn(
                    "pb-2 text-xs font-medium transition-all relative font-sans uppercase tracking-wider",
                    sidebarTab === 'highlights' ? "text-primary" : "text-surface hover:text-foreground"
                  )}
                >
                  Highlights
                  {sidebarTab === 'highlights' && <motion.div layoutId="sidebarTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
                <button 
                  onClick={() => setSidebarTab('bookmarks')}
                  className={cn(
                    "pb-2 text-xs font-medium transition-all relative font-sans uppercase tracking-wider",
                    sidebarTab === 'bookmarks' ? "text-primary" : "text-surface hover:text-foreground"
                  )}
                >
                  Bookmarks
                  {sidebarTab === 'bookmarks' && <motion.div layoutId="sidebarTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />}
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto">
                {sidebarTab === 'ai' ? (
                  <div className="p-5">
                    {aiResponse ? (
                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`p-4 rounded-2xl text-sm leading-relaxed ${theme === 'dark' ? 'bg-background/5 text-background' : 'bg-foreground/5 text-foreground'}`}
                      >
                        {aiResponse}
                      </motion.div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center text-sm text-surface px-4 gap-4 mt-20 font-sans">
                        <p>Ask me to summarize the page, explain a concept, or translate text.</p>
                        <button
                          onClick={() => {
                            const query = "Please explain the contents of this page in simple terms.";
                            setAiQuery(query);
                            handleAskAi(query);
                          }}
                          className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-full transition-colors flex items-center gap-2 font-sans uppercase tracking-wider text-xs"
                        >
                          <Sparkles className="w-4 h-4" />
                          Explain Current Page
                        </button>
                      </div>
                    )}
                  </div>
                ) : sidebarTab === 'highlights' ? (
                  <div className="p-5 flex flex-col gap-3">
                    {book.highlights && book.highlights.length > 0 ? (
                      book.highlights.sort((a, b) => a.page - b.page).map(highlight => (
                        <div
                          key={highlight.id}
                          className={cn(
                            "flex flex-col gap-2 p-3 rounded-xl transition-all text-left group relative",
                            theme === 'dark' ? "bg-background/5 hover:bg-background/10" : "bg-foreground/5 hover:bg-foreground/10"
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <button 
                              onClick={() => handlePageChange(highlight.page)}
                              className="flex items-center gap-2"
                            >
                              <div className="w-4 h-4 rounded-full shadow-sm" style={{ backgroundColor: highlight.color }} />
                              <span className="text-xs font-medium font-sans">Page {highlight.page + 1}</span>
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  const query = `Explain the context of this highlighted section on page ${highlight.page + 1}.`;
                                  setAiQuery(query);
                                  setAiPanelOpen(true);
                                  setSidebarTab('ai');
                                  handleAskAi(query);
                                }}
                                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary rounded-md transition-all"
                                title="Explain with AI"
                              >
                                <Sparkles className="w-3 h-3" />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updatedBook = { ...book, highlights: book.highlights!.filter(h => h.id !== highlight.id) };
                                  setBook(updatedBook);
                                  saveBook(updatedBook);
                                }}
                                className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary rounded-md transition-all"
                                title="Remove Highlight"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                          <div className="text-[10px] text-surface italic font-serif">
                            Highlight section
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center text-sm text-surface px-4 gap-4 mt-20 font-sans">
                        <Highlighter className="w-8 h-8 opacity-20" />
                        <p>No highlights yet. Use the highlighter tool to mark important sections.</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-5 flex flex-col gap-3">
                    {book.pins && book.pins.length > 0 ? (
                      book.pins.sort((a, b) => a.page - b.page).map(pin => (
                        <button
                          key={pin.id}
                          onClick={() => handlePageChange(pin.page)}
                          className={cn(
                            "flex items-center gap-3 p-3 rounded-xl transition-all text-left group",
                            theme === 'dark' ? "bg-background/5 hover:bg-background/10" : "bg-foreground/5 hover:bg-foreground/10"
                          )}
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm" style={{ backgroundColor: `${pin.color}20` }}>
                            <Paperclip className="w-4 h-4" style={{ color: pin.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium font-sans">Page {pin.page + 1}</div>
                            <div className="text-[10px] text-surface truncate font-sans">Bookmark Pin</div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const updatedBook = { ...book, pins: book.pins!.filter(p => p.id !== pin.id) };
                              setBook(updatedBook);
                              saveBook(updatedBook);
                            }}
                            className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-primary/10 hover:text-primary rounded-md transition-all"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </button>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-center text-sm text-surface px-4 gap-4 mt-20 font-sans">
                        <Paperclip className="w-8 h-8 opacity-20" />
                        <p>No bookmarks yet. Use the paperclip tool to pin important pages.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {sidebarTab === 'ai' && (
                <div className={`p-5 border-t ${theme === 'dark' ? 'border-background/5' : 'border-foreground/5'}`}>
                  <div className="relative">
                    <textarea
                      value={aiQuery}
                      onChange={e => setAiQuery(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleAskAi();
                        }
                      }}
                      placeholder="Ask something..."
                      className={`w-full rounded-2xl pl-4 pr-12 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all font-sans ${theme === 'dark' ? 'bg-background/5 text-background placeholder-surface' : 'bg-foreground/5 text-foreground placeholder-surface'}`}
                      rows={2}
                    />
                    <button 
                      onClick={() => handleAskAi()}
                      disabled={isAiLoading || !aiQuery.trim()}
                      className="absolute right-2 bottom-2 p-2 bg-primary hover:bg-primary/90 disabled:bg-surface disabled:opacity-50 text-background rounded-xl transition-all active:scale-95 shadow-lg shadow-primary/20"
                    >
                      {isAiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowLeft className="w-4 h-4 rotate-180" />}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Selection Toolbar */}
      <AnimatePresence>
        {selectionMenu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            className="fixed z-[100] -translate-x-1/2 -translate-y-full mb-4 flex items-center gap-1 p-1 bg-foreground/90 backdrop-blur-md border border-background/10 rounded-full shadow-2xl"
            style={{ left: selectionMenu.x, top: selectionMenu.y }}
          >
            <button
              onClick={() => {
                // Trigger highlight logic
                // Since we have the text and selection, we can try to highlight it
                // For now, we'll just turn on highlight mode and let the user click
                // or we could try to automate it if we had the range
                setIsHighlightMode(true);
                setSelectionMenu(null);
              }}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-background/10 rounded-full text-xs font-medium text-background transition-colors font-sans uppercase tracking-wider"
            >
              <Highlighter className="w-3.5 h-3.5 text-primary" />
              Highlight
            </button>
            <div className="w-px h-4 bg-background/10 mx-1" />
            <button
              onClick={() => {
                const query = `Explain this text from the book: "${selectionMenu.text}"`;
                setAiQuery(query);
                setAiPanelOpen(true);
                setSidebarTab('ai');
                handleAskAi(query);
                setSelectionMenu(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-background/10 rounded-full text-xs font-medium text-background transition-colors font-sans uppercase tracking-wider"
            >
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              Ask AI
            </button>
            <button
              onClick={() => {
                setSelectionMenu(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="p-1.5 hover:bg-background/10 rounded-full text-surface transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
