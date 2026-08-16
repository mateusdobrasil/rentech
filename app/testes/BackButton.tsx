"use client";

import Link from 'next/link';

export default function BackButton({ href = '/testes' }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Voltar para Testes"
      className="absolute top-3 left-3 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/60 backdrop-blur text-white/70 hover:text-white hover:border-[#336699] active:scale-90 transition-all"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 19l-7-7 7-7" />
      </svg>
    </Link>
  );
}
