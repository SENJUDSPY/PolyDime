/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { Auth } from './components/Auth';
import { Profile } from './components/Profile';
import { AppExplainer } from './components/AppExplainer';
import { ErrorBoundary } from './components/ErrorBoundary';
import { auth } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { Loader2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function App() {
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | undefined>();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      if (currentUser) {
        setShowAuth(false);
      }
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AnimatePresence mode="wait">
        {currentBookId ? (
          <motion.div 
            key="reader"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="h-screen w-full"
          >
            <Reader bookId={currentBookId} onBack={() => setCurrentBookId(null)} />
          </motion.div>
        ) : (
          <motion.div 
            key="library"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="relative min-h-screen bg-background"
          >
            <Library 
              onOpenBook={setCurrentBookId} 
              onRequireAuth={() => {
                setAuthMessage("Please enter your details for our verification of humans and for your materials/resources purpose so we need your details");
                setShowAuth(true);
              }} 
              headerActions={
                user ? (
                  <button 
                    onClick={() => setShowProfile(true)}
                    className="flex items-center gap-2 sm:gap-3 bg-surface/10 backdrop-blur-md pl-1.5 pr-3 sm:pr-4 py-1.5 rounded-full border border-surface/20 hover:bg-primary/10 transition-colors whitespace-nowrap"
                  >
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Profile" className="w-7 h-7 sm:w-8 sm:h-8 rounded-full" />
                    ) : (
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs sm:text-sm">
                        {user.displayName?.charAt(0) || user.email?.charAt(0) || 'U'}
                      </div>
                    )}
                    <span className="text-sm font-medium text-foreground hidden sm:block font-sans">{user.displayName || user.email}</span>
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setAuthMessage(undefined);
                      setShowAuth(true);
                    }}
                    className="bg-primary hover:bg-primary/90 text-background px-4 sm:px-6 py-2.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap font-sans uppercase tracking-wider"
                  >
                    Sign In
                  </button>
                )
              }
            />
            {showProfile && user && <Profile user={user} onClose={() => setShowProfile(false)} />}
            {showAuth && !user && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 backdrop-blur-sm p-4 overflow-y-auto">
                <div className="relative w-full max-w-md my-auto">
                  <button 
                    onClick={() => setShowAuth(false)}
                    className="absolute -top-12 right-0 text-surface hover:text-foreground transition-colors bg-background/50 p-2 rounded-full"
                  >
                    <X className="w-6 h-6" />
                  </button>
                  <Auth 
                    isModal={true} 
                    message={authMessage} 
                    initialIsLogin={!authMessage}
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <AppExplainer />
    </ErrorBoundary>
  );
}
