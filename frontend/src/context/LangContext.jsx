import { createContext, useContext, useState, useEffect } from 'react';
import en from '../locales/en.js';
import hi from '../locales/hi.js';
import zh from '../locales/zh.js';

const locales = { en, hi, zh };

const LangContext = createContext(null);

export function LangProvider({ children, initialLang }) {
  const [lang, setLangState] = useState(() => {
    return initialLang ?? localStorage.getItem('nb_lang') ?? 'en';
  });

  useEffect(() => {
    if (initialLang && initialLang !== lang) setLangState(initialLang);
  }, [initialLang]);

  const setLang = (l) => {
    setLangState(l);
    localStorage.setItem('nb_lang', l);
  };

  const t = locales[lang] ?? locales.en;

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
