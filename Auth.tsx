import React, { useState, useEffect, useRef } from 'react';
import { Book, subscribeToBooks, saveBook, deleteBook, getBook } from '../lib/db';
import { v4 as uuidv4 } from 'uuid';
import { loadPdf, renderPdfPage, extractPdfText } from '../lib/pdf';
import { BookOpen, Plus, Trash2, Search, Clock, Library as LibraryIcon, CheckCircle, Image as ImageIcon, Loader2, Sparkles, X, Upload } from 'lucide-react';
import { auth } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BookCover = ({ book }: { book: Book }) => {
  if (book.coverUrl) {
    return (
      <div className="w-full h-full relative">
        <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
      </div>
    );
  }
  return (
    <div className="w-full h-full bg-background flex flex-col items-center justify-center p-6 text-center gap-4 border-l-4 border-primary/40 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-surface/20 via-transparent to-transparent" />
      </div>
      <BookOpen className="w-12 h-12 text-surface mb-2 relative z-10" />
      <h4 className="text-foreground font-serif text-sm font-medium leading-tight line-clamp-4 italic relative z-10">
        {book.title}
      </h4>
      <div className="absolute bottom-6 left-6 right-6 h-px bg-surface/20" />
      <div className="absolute top-6 left-6 right-6 h-px bg-surface/20" />
    </div>
  );
};

export const Library = ({ onOpenBook, onRequireAuth, headerActions }: { onOpenBook: (id: string) => void, onRequireAuth?: () => void, headerActions?: React.ReactNode }) => {
  const [books, setBooks] = useState<Book[]>([]);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'reading' | 'read'>('reading');
  const [generatingCovers, setGeneratingCovers] = useState<Set<string>>(new Set());
  const [coverModalBook, setCoverModalBook] = useState<Book | null>(null);
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [pendingCoverBooks, setPendingCoverBooks] = useState<Book[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = subscribeToBooks((allBooks) => {
      setBooks(allBooks);
    });
    return () => unsubscribe();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (files.length === 0) return;

    if (!auth.currentUser && onRequireAuth) {
      onRequireAuth();
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const newUploadedBooks: Book[] = [];

    for (const file of files) {
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const arrayBuffer = await file.arrayBuffer();
      let coverUrl = '';
      let totalPages = 0;

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        try {
          const pdf = await loadPdf(arrayBuffer);
          totalPages = pdf.numPages;
          
          if (totalPages > 0) {
          // Use a smaller scale for the cover to keep the data URL small
          coverUrl = await renderPdfPage(pdf, 1, 'temp', 0.3);
          if (coverUrl.length > 200000) {
            console.warn('Cover image too large, skipping cover');
            coverUrl = '';
          }
          } else {
            throw new Error('PDF has no pages');
          }
        } catch (err) {
          console.error('Failed to parse PDF', err);
          alert(`Failed to parse PDF: ${file.name}`);
          continue;
        }
      } else {
        alert(`Only PDF files are supported currently. Skipped: ${file.name}`);
        continue;
      }

      const newBook: Book = {
        id: uuidv4(),
        title: file.name.replace(/\.pdf$/i, '').substring(0, 190) || 'Untitled', // Truncate to fit Firestore rules
        fileData: fileData,
        lastOpened: Date.now(),
        currentPage: 0,
        totalPages,
        status: 'reading'
      };
      
      if (coverUrl) {
        newBook.coverUrl = coverUrl;
      }

      try {
        await saveBook(newBook);
        newUploadedBooks.push(newBook);
      } catch (err) {
        console.error('Failed to save book', err);
        alert(`Failed to save book: ${file.name}. The file might be too large or there was a network error.`);
      }
    }
    
    if (newUploadedBooks.length > 0) {
      setPendingCoverBooks(newUploadedBooks);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this book?')) {
      await deleteBook(id);
    }
  };

  const handleToggleStatus = async (e: React.MouseEvent, book: Book) => {
    e.stopPropagation();
    const newStatus: 'reading' | 'read' = book.status === 'read' ? 'reading' : 'read';
    const updatedBook: Book = { ...book, status: newStatus };
    await saveBook(updatedBook);
  };

  const ensureApiKey = async () => {
    if (typeof window !== 'undefined' && (window as any).aistudio) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }
    }
  };

  const handleGenerateCoverAction = async (book: Book, size: string) => {
    if (generatingCovers.has(book.id)) return;
    setGeneratingCovers(prev => new Set(prev).add(book.id));
    setCoverModalBook(null);
    try {
      await ensureApiKey();
      const dynamicAi = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY || '' });

      const fullBook = await getBook(book.id);
      if (!fullBook || !fullBook.fileData) throw new Error('Could not load book data');

      const pdf = await loadPdf(fullBook.fileData);
      const text = await extractPdfText(pdf, 1);
      const text2 = fullBook.totalPages > 1 ? await extractPdfText(pdf, 2) : '';
      
      const combinedText = `${text}\n${text2}`.substring(0, 1000); // Take first 1000 chars

      const prompt = `Generate a beautiful, minimalist book cover for a book with the following content/title. Make it look like a modern, professional book cover without any text on it. Content: ${combinedText}`;

      const response = await dynamicAi.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: prompt,
        config: {
          imageConfig: {
            imageSize: size as any,
            aspectRatio: "3:4"
          }
        }
      });

      let base64Image = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          base64Image = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }

      if (base64Image) {
        const updatedBook = { ...book, coverUrl: base64Image };
        await saveBook(updatedBook);
      } else {
        alert('Failed to generate cover image.');
      }
    } catch (error: any) {
      console.error('Error generating cover:', error);
      if (error?.message?.includes('Requested entity was not found') || error?.message?.includes('PERMISSION_DENIED') || error?.message?.includes('permission')) {
        alert('API Key error: Please ensure you have selected a valid Google Cloud API key with billing enabled.');
        if (typeof window !== 'undefined' && (window as any).aistudio) {
          (window as any).aistudio.openSelectKey();
        }
      } else {
        alert('Error generating cover. Please try again.');
      }
    } finally {
      setGeneratingCovers(prev => {
        const next = new Set(prev);
        next.delete(book.id);
        return next;
      });
    }
  };

  const handleUploadCover = async (e: React.ChangeEvent<HTMLInputElement>, book: Book) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Image = event.target?.result as string;
      if (base64Image) {
        const updatedBook = { ...book, coverUrl: base64Image };
        await saveBook(updatedBook);
      }
    };
    reader.readAsDataURL(file);
  };

  const filteredBooks = books.filter(b => {
    const matchesSearch = b.title.toLowerCase().includes(search.toLowerCase());
    const matchesTab = activeTab === 'read' ? b.status === 'read' : (b.status !== 'read');
    return matchesSearch && matchesTab;
  });
  
  const recentBooks = books.filter(b => b.status !== 'read').slice(0, 3);

  const renderBookCard = (book: Book, index: number, prefix: string = '') => (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      key={`${prefix}${book.id}`}
      onClick={() => onOpenBook(book.id)}
      className="group cursor-pointer flex flex-col relative [perspective:1200px]"
    >
      <div className="relative w-full aspect-[2/3] mb-4">
        <motion.div
          className="relative w-full h-full origin-left"
          style={{ transformStyle: 'preserve-3d' }}
          initial={{ rotateY: 25, rotateX: -5, translateZ: 0 }}
          whileHover={{ rotateY: 0, rotateX: 0, translateZ: 60, translateY: -12, scale: 1.05 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          {/* Front Cover */}
          <div 
            className="absolute inset-0 bg-background rounded-r-sm overflow-hidden border border-surface/20"
            style={{ transform: 'translateZ(0px)', backfaceVisibility: 'hidden' }}
          >
            <BookCover book={book} />
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/90 via-foreground/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-end pb-6 gap-2">
              <div className="flex items-center justify-center gap-2 transform translate-y-8 group-hover:translate-y-0 transition-all duration-300">
                <button
                  onClick={(e) => handleToggleStatus(e, book)}
                  className="p-2 bg-primary/90 hover:bg-primary rounded-full text-background shadow-lg backdrop-blur-sm"
                  title={book.status === 'read' ? 'Mark as Reading' : 'Mark as Read'}
                >
                  <CheckCircle className="w-4 h-4" />
                </button>
                <label
                  className="p-2 bg-surface/90 hover:bg-primary rounded-full text-background shadow-lg backdrop-blur-sm cursor-pointer"
                  title="Upload Custom Cover"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Upload className="w-4 h-4" />
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleUploadCover(e, book)}
                  />
                </label>
                <button
                  onClick={(e) => { e.stopPropagation(); setCoverModalBook(book); }}
                  disabled={generatingCovers.has(book.id)}
                  className="p-2 bg-primary/90 hover:bg-primary rounded-full text-background shadow-lg backdrop-blur-sm disabled:opacity-50"
                  title="Generate AI Cover"
                >
                  {generatingCovers.has(book.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
                </button>
                <button
                  onClick={(e) => handleDelete(e, book.id)}
                  className="p-2 bg-foreground/90 hover:bg-foreground rounded-full text-background shadow-lg backdrop-blur-sm"
                  title="Delete Book"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            {/* Progress indicator on cover */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-background/80 backdrop-blur-sm">
              <div 
                className="h-full bg-primary" 
                style={{ width: `${(Math.max(1, book.currentPage) / book.totalPages) * 100}%` }}
              />
            </div>
          </div>
          
          {/* Back Cover */}
          <div className="absolute inset-0 bg-background rounded-l-sm border border-surface/20" style={{ transform: 'translateZ(-30px) rotateY(180deg)' }} />

          {/* Spine (Left) */}
          <div className="absolute top-0 bottom-0 left-0 w-[30px] bg-foreground flex items-center justify-center overflow-hidden origin-left" style={{ transform: 'rotateY(-90deg)' }}>
            <span className="text-[10px] text-surface whitespace-nowrap -rotate-90">{book.title}</span>
          </div>

          {/* Pages (Right) */}
          <div className="absolute top-[2px] bottom-[2px] right-0 w-[30px] bg-background origin-right border-l border-surface/20" style={{ transform: 'rotateY(90deg)' }}>
            <div className="w-full h-full flex flex-col justify-evenly opacity-20">
              {Array.from({length: 10}).map((_, i) => <div key={i} className="w-full h-[1px] bg-foreground" />)}
            </div>
          </div>
          
          {/* Pages (Top) */}
          <div className="absolute top-0 left-[2px] right-[2px] h-[30px] bg-background origin-top border-b border-surface/20" style={{ transform: 'rotateX(90deg)' }} />
          
          {/* Pages (Bottom) */}
          <div className="absolute bottom-0 left-[2px] right-[2px] h-[30px] bg-background origin-bottom border-t border-surface/20" style={{ transform: 'rotateX(-90deg)' }} />
        </motion.div>

        {/* Shelf */}
        <div className="absolute -bottom-4 left-[-20%] right-[-20%] h-4 bg-gradient-to-b from-surface/20 to-surface/40 shadow-[0_15px_30px_rgba(0,0,0,0.1)] border-t border-surface/10 z-[-1]" />
      </div>
      
      <div className="flex flex-col items-center w-full mt-4 pt-4 border-t border-surface/10 relative">
        <div className="absolute top-4 left-1/2 -translate-x-1/2 w-full h-full bg-gradient-to-b from-surface/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 -z-10 rounded-xl" />
        <h3 className="font-semibold text-foreground text-sm px-1 w-full text-center group-hover:text-primary transition-colors line-clamp-2 min-h-[2.5rem] flex items-center justify-center leading-tight font-serif tracking-wide">
          {book.title}
        </h3>
        <div className="w-full px-3 mt-3">
          <div className="flex items-center justify-between text-[10px] text-surface mb-1.5 font-sans uppercase tracking-wider font-medium">
            <span className="bg-surface/10 px-1.5 py-0.5 rounded border border-surface/20">
              {Math.round((Math.max(1, book.currentPage) / (book.totalPages || 1)) * 100)}%
            </span>
            <span className="opacity-80">
              {Math.max(1, book.currentPage)} / {book.totalPages} pages
            </span>
          </div>
          <div className="h-1 w-full bg-surface/20 rounded-full overflow-hidden border border-surface/5">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${(Math.max(1, book.currentPage) / (book.totalPages || 1)) * 100}%` }}
              className="h-full bg-primary"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-screen bg-background text-foreground p-8 selection:bg-primary/20"
    >
      <div className="max-w-7xl mx-auto">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-16">
          <motion.h1 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-5xl font-serif tracking-tight flex items-center gap-4"
          >
            <div className="p-3 bg-primary/5 rounded-2xl border border-primary/10">
              <BookOpen className="w-10 h-10 text-primary" />
            </div>
            Flipverse
          </motion.h1>
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto"
          >
            <div className="relative flex-1 sm:flex-none">
              <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-surface" />
              <input
                type="text"
                placeholder="Search library..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full sm:w-72 bg-background border border-surface/30 rounded-full py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-surface/60"
              />
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-primary hover:bg-primary/90 text-background px-4 sm:px-6 py-2.5 rounded-full text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/10 active:scale-95 whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Add Book</span>
            </button>
            {headerActions && (
              <>
                <div className="w-px h-6 bg-surface/20 hidden sm:block mx-1" />
                <div className="shrink-0">
                  {headerActions}
                </div>
              </>
            )}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUpload}
              accept=".pdf,.PDF,application/pdf"
              multiple
              className="hidden"
            />
          </motion.div>
        </header>

        {books.length === 0 ? (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-center py-32 border border-surface/20 rounded-[2rem] bg-background shadow-sm"
          >
            <div className="w-20 h-20 mx-auto bg-background rounded-full flex items-center justify-center mb-6 border border-surface/30 shadow-sm">
              <BookOpen className="w-8 h-8 text-surface" />
            </div>
            <h2 className="text-3xl font-serif text-foreground mb-2">Your library is empty</h2>
            <p className="text-surface mb-8 max-w-sm mx-auto font-sans">Upload a PDF book to start reading. Your progress will be saved automatically.</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-primary hover:bg-primary/90 text-background px-8 py-3 rounded-full font-medium transition-all active:scale-95 shadow-lg shadow-primary/10"
            >
              Upload PDF
            </button>
          </motion.div>
        ) : (
          <div className="space-y-16">
            <div className="flex items-center gap-8 border-b border-surface/20 pb-4">
              <button
                onClick={() => setActiveTab('reading')}
                className={`text-xl font-serif transition-colors relative ${activeTab === 'reading' ? 'text-primary' : 'text-surface hover:text-foreground'}`}
              >
                Reading
                {activeTab === 'reading' && <motion.div layoutId="tab" className="absolute -bottom-4 left-0 right-0 h-0.5 bg-primary" />}
              </button>
              <button
                onClick={() => setActiveTab('read')}
                className={`text-xl font-serif transition-colors relative ${activeTab === 'read' ? 'text-primary' : 'text-surface hover:text-foreground'}`}
              >
                Read
                {activeTab === 'read' && <motion.div layoutId="tab" className="absolute -bottom-4 left-0 right-0 h-0.5 bg-primary" />}
              </button>
            </div>

            {!search && recentBooks.length > 0 && activeTab === 'reading' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <h2 className="text-2xl font-serif text-foreground mb-8 flex items-center gap-3">
                  <Clock className="w-6 h-6 text-primary" />
                  Recently Opened
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-10 gap-y-12">
                  <AnimatePresence mode="popLayout">
                    {recentBooks.map((book, index) => renderBookCard(book, index, 'recent-'))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="text-2xl font-serif text-foreground mb-8 flex items-center gap-3">
                <LibraryIcon className="w-6 h-6 text-primary" />
                {search ? 'Search Results' : 'All Books'}
              </h2>
              <motion.div 
                layout
                className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-10 gap-y-12"
              >
                <AnimatePresence mode="popLayout">
                  {filteredBooks.map((book, index) => renderBookCard(book, index, 'all-'))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          </div>
        )}
      </div>

      {/* Cover Generation Modal */}
      <AnimatePresence>
        {coverModalBook && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4" onClick={() => setCoverModalBook(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background border border-surface/30 rounded-2xl p-8 max-w-sm w-full shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-2xl font-serif text-foreground flex items-center gap-3">
                  <ImageIcon className="w-6 h-6 text-primary" />
                  Generate Cover
                </h3>
                <button onClick={() => setCoverModalBook(null)} className="text-surface hover:text-foreground">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-surface text-sm mb-8 font-sans">
                Select the resolution for the AI-generated cover. Higher resolutions may take longer.
              </p>
              <div className="space-y-4 mb-8">
                {['1K', '2K', '4K'].map((size) => (
                  <label key={size} className="flex items-center gap-3 p-4 rounded-xl border border-surface/20 cursor-pointer hover:bg-surface/5 transition-colors">
                    <input type="radio" name="imageSize" value={size} checked={imageSize === size} onChange={(e) => setImageSize(e.target.value as any)} className="text-primary focus:ring-primary bg-background border-surface" />
                    <span className="text-foreground font-sans font-medium">{size} Resolution</span>
                  </label>
                ))}
              </div>
              <button
                onClick={() => handleGenerateCoverAction(coverModalBook, imageSize)}
                className="w-full py-4 bg-primary hover:bg-primary/90 text-background rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-primary/10"
              >
                <ImageIcon className="w-5 h-5" />
                Generate Now
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Auto-Generate Covers Modal */}
      <AnimatePresence>
        {pendingCoverBooks.length > 0 && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border border-surface/30 rounded-2xl p-8 max-w-md w-full shadow-2xl"
            >
              <h3 className="text-2xl font-serif text-foreground mb-4 flex items-center gap-3">
                <Sparkles className="w-6 h-6 text-primary" />
                Generate AI Covers?
              </h3>
              <p className="text-surface text-sm mb-8 font-sans">
                You just added {pendingCoverBooks.length} book(s). Would you like to automatically generate beautiful AI covers for them?
              </p>
              <div className="flex justify-end gap-4">
                <button
                  onClick={() => setPendingCoverBooks([])}
                  className="px-6 py-3 rounded-xl text-surface hover:text-foreground hover:bg-surface/10 transition-colors font-medium font-sans"
                >
                  No thanks
                </button>
                <button
                  onClick={() => {
                    const booksToProcess = [...pendingCoverBooks];
                    setPendingCoverBooks([]);
                    booksToProcess.forEach(b => handleGenerateCoverAction(b, '1K'));
                  }}
                  className="px-6 py-3 bg-primary hover:bg-primary/90 text-background rounded-xl transition-colors font-medium flex items-center gap-2 shadow-lg shadow-primary/10 font-sans"
                >
                  <ImageIcon className="w-5 h-5" />
                  Yes, generate
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </motion.div>
  );
};
