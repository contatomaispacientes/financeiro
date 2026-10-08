import {
  ChartColumn,
  CirclePlus,
  LayoutDashboard,
  Package,
  Receipt,
  Repeat,
  ScrollText,
  Settings,
  Signature,
  UserCog,
  Users,
  Wallet,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import { can, type Permission, type Role } from '@financeiro/shared';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  permission: Permission;
  /** Rota exata: evita que "/" fique ativo em todas as telas. */
  end?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigation: NavGroup[] = [
  {
    label: 'Análise',
    items: [
      { label: 'Visão geral', to: '/', icon: LayoutDashboard, permission: 'VIEW_REPORTS', end: true },
      { label: 'Fluxo de caixa', to: '/fluxo', icon: ChartColumn, permission: 'VIEW_REPORTS' },
    ],
  },
  {
    label: 'Contas a receber',
    items: [
      { label: 'Nova cobrança', to: '/cobrancas/nova', icon: CirclePlus, permission: 'MANAGE_CHARGES' },
      { label: 'Cobranças', to: '/cobrancas', icon: Receipt, permission: 'VIEW_REPORTS', end: true },
      { label: 'Recorrências', to: '/assinaturas', icon: Repeat, permission: 'VIEW_REPORTS' },
      { label: 'Contratos', to: '/contratos', icon: Signature, permission: 'VIEW_REPORTS' },
      { label: 'Clientes', to: '/clientes', icon: Users, permission: 'VIEW_REPORTS' },
      { label: 'Serviços', to: '/servicos', icon: Package, permission: 'VIEW_REPORTS' },
    ],
  },
  {
    label: 'Contas a pagar',
    items: [{ label: 'Despesas', to: '/despesas', icon: Wallet, permission: 'VIEW_REPORTS' }],
  },
  {
    label: 'Sistema',
    items: [
      { label: 'Configurações', to: '/configuracoes', icon: Settings, permission: 'VIEW_REPORTS', end: true },
      { label: 'Usuários', to: '/configuracoes/usuarios', icon: UserCog, permission: 'ADMINISTER' },
      { label: 'Log de eventos', to: '/configuracoes/webhooks', icon: Webhook, permission: 'ADMINISTER' },
      { label: 'Auditoria', to: '/configuracoes/auditoria', icon: ScrollText, permission: 'ADMINISTER' },
    ],
  },
];

/** Grupos e itens que o papel pode ver; grupos vazios somem (FND-06.3). */
export function navigationFor(role: Role | undefined): NavGroup[] {
  return navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => can(role, item.permission)) }))
    .filter((group) => group.items.length > 0);
}
