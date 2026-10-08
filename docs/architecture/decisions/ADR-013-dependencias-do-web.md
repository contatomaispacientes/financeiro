# ADR-013 — Dependências do web trazidas pelo shadcn/ui e pelo scaffold

**Status:** Aceito · 07/10/2026 · Complementa o ADR-001 e o `stack.md` (frontend)

## Contexto
O `stack.md` define Tailwind CSS + shadcn/ui (Radix) e fontes Geist. Na tarefa 9 da fundação o shadcn foi iniciado pelo CLI oficial (`shadcn@4`, preset **Nova**, base Radix) sobre Tailwind 4. O CLI atual instala pacotes que não aparecem nominalmente no `stack.md`.

## Decisão
Aceitar, como parte do "shadcn/ui" do `stack.md`:

| Pacote | Por quê |
| --- | --- |
| `radix-ui` | Pacote único do Radix usado pelos componentes gerados (substitui os `@radix-ui/react-*` avulsos, removidos) |
| `cn` | `cn()` de junção de classes, mantido pelo autor do shadcn (`github.com/shadcn-ui/cn`); substitui `clsx` + `tailwind-merge` (removidos) |
| `shadcn` | Fornece `shadcn/tailwind.css` importado no `index.css` |
| `tw-animate-css` | Animações dos componentes (Dialog, Sheet, Dropdown) |
| `sonner` | Toast recomendado pelo shadcn; o componente foi ajustado para não depender de `next-themes` (só tema claro na v1) |
| `@tailwindcss/vite` | Plugin oficial do Tailwind 4 para Vite (substitui `postcss` + `autoprefixer`, removidos) |
| `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` | Fontes servidas pelo próprio app, sem CDN externo |
| `jsdom`, `@testing-library/user-event` (dev) | Ambiente DOM e interação nos testes de componente |

Não adotados: `next-themes` (sem troca de tema na v1) e `react-day-picker` — o `DatePicker` usa o `<input type="date">` nativo (acessível, calendário do sistema no celular, sem fuso).

## Consequências
- Componentes em `apps/web/src/components/ui` são gerados pelo CLI (`pnpm dlx shadcn@4 add <nome>`) e podem ser editados localmente.
- O `cn` é um pacote jovem; se for abandonado, volta a ser `clsx` + `tailwind-merge` em `src/lib/utils.ts` sem mexer nos componentes.
