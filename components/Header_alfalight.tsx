"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { company } from "@/lib/content";

const navLinks = [
  { href: "#equipamentos", label: "Equipamentos" },
  { href: "#simulador", label: "Simulador" },
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#orcamento", label: "Orçamento" },
  { href: "#faq", label: "FAQ" },
  { href: "#contato", label: "Contato" },
];

const accessLinks = [
  { href: "https://portal.alfalight.com.br/freelance", label: "Freelance" },
  { href: "https://portal.alfalight.com.br/login", label: "Sistema WEB" },
  {
    href: "https://portal.alfalight.com.br/portal/login",
    label: "Portal do Funcionário",
  },
];

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAccessMenuOpen, setIsAccessMenuOpen] = useState(false);
  const accessMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAccessMenuOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (!accessMenuRef.current?.contains(event.target as Node)) {
        setIsAccessMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isAccessMenuOpen]);

  return (
    <header className="sticky top-0 z-50 border-b border-black/5 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
        <Link
          href="#"
          className="flex items-center gap-2"
          onClick={() => setIsMenuOpen(false)}
        >
          <Image
            src="/logo-alfalight.png"
            alt="Alfalight Locadora"
            width={160}
            height={58}
            priority
            className="h-10 w-auto sm:h-12"
          />
        </Link>

        <nav className="hidden items-center gap-5 text-sm font-medium text-neutral-700 lg:flex xl:gap-7">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="transition-colors hover:text-brand-crimson"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <div className="relative hidden sm:block" ref={accessMenuRef}>
            <button
              type="button"
              onClick={() => setIsAccessMenuOpen((open) => !open)}
              aria-expanded={isAccessMenuOpen}
              aria-controls="access-menu"
              aria-label="Menu de acesso"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 transition-colors hover:border-brand-crimson hover:text-brand-crimson"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            {isAccessMenuOpen && (
              <div
                id="access-menu"
                className="absolute right-0 top-full mt-2 flex w-52 flex-col overflow-hidden rounded-xl border border-black/5 bg-white py-1 shadow-lg"
              >
                {accessLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsAccessMenuOpen(false)}
                    className="px-4 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-brand-pink-light hover:text-brand-crimson"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          <a
            href={company.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden shrink-0 items-center gap-2 rounded-full bg-brand-crimson px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-crimson-dark sm:inline-flex"
          >
            Fale no WhatsApp
          </a>

          <button
            type="button"
            onClick={() => setIsMenuOpen((open) => !open)}
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
            aria-label={isMenuOpen ? "Fechar menu" : "Abrir menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-neutral-700 transition-colors hover:bg-black/5 lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-6 w-6">
              {isMenuOpen ? (
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </div>

      {isMenuOpen && (
        <nav
          id="mobile-nav"
          className="flex flex-col gap-1 border-t border-black/5 bg-white px-5 py-3 lg:hidden"
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setIsMenuOpen(false)}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-neutral-700 transition-colors hover:bg-brand-pink-light hover:text-brand-crimson"
            >
              {link.label}
            </a>
          ))}
          <a
            href={company.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setIsMenuOpen(false)}
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-brand-crimson px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-crimson-dark sm:hidden"
          >
            Fale no WhatsApp
          </a>
          {accessLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:border-brand-crimson hover:text-brand-crimson"
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
