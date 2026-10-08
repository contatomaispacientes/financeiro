import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import type { UserDto } from '@financeiro/shared';
import { PageHeader } from '@/components/page-header';
import { PaginationBar } from '@/components/pagination-bar';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/states';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSession } from '@/lib/auth';
import { errorMessage } from '@/lib/form-errors';
import { formatDateTime, roleLabels } from '@/lib/format';
import { cn } from '@/lib/utils';
import { USERS_PAGE_SIZE, useUpdateUser, useUsers } from './api';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { UserFormDialog } from './UserFormDialog';

export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('pagina')) || 1);
  const { user: me } = useSession();
  const users = useUsers(page);
  const updateUser = useUpdateUser();

  const [formUser, setFormUser] = useState<UserDto | 'new' | null>(null);
  const [resetUser, setResetUser] = useState<UserDto | null>(null);
  const [deactivateUser, setDeactivateUser] = useState<UserDto | null>(null);

  async function setActive(user: UserDto, active: boolean) {
    try {
      await updateUser.mutateAsync({ id: user.id, input: { active } });
      toast.success(active ? `${user.name} foi reativado.` : `${user.name} foi desativado.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Quem acessa o sistema e o que cada papel pode fazer."
        actions={
          <Button onClick={() => setFormUser('new')}>
            <UserPlus aria-hidden />
            Novo usuário
          </Button>
        }
      />

      {users.isPending ? (
        <TableSkeleton />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => users.refetch()} />
      ) : users.data.data.length === 0 ? (
        <EmptyState title="Nenhum usuário" description="Crie o primeiro usuário para dar acesso à equipe." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Último acesso</TableHead>
                  <TableHead className="text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.data.data.map((user) => (
                  <TableRow key={user.id} className={cn(!user.active && 'text-muted-foreground')}>
                    <TableCell className="font-medium">
                      {user.name}
                      {user.id === me?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>{roleLabels[user.role]}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
                          user.active
                            ? 'bg-emerald-100 text-emerald-900 ring-emerald-300'
                            : 'bg-zinc-100 text-zinc-700 ring-zinc-300',
                        )}
                      >
                        <span aria-hidden className={cn('size-1.5 rounded-full', user.active ? 'bg-emerald-600' : 'bg-zinc-400')} />
                        {user.active ? 'Ativo' : 'Inativo'}
                      </span>
                    </TableCell>
                    <TableCell className="tabular text-sm">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Nunca entrou'}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setFormUser(user)} aria-label={`Editar ${user.name}`}>
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setResetUser(user)} aria-label={`Redefinir senha de ${user.name}`}>
                          Senha
                        </Button>
                        {user.active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeactivateUser(user)}
                            aria-label={`Desativar ${user.name}`}
                          >
                            Desativar
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setActive(user, true)}
                            aria-label={`Reativar ${user.name}`}
                          >
                            Reativar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationBar
            page={page}
            pageSize={USERS_PAGE_SIZE}
            total={users.data.meta.total}
            onPageChange={(next) => setParams(next > 1 ? { pagina: String(next) } : {})}
          />
        </>
      )}

      <UserFormDialog
        open={formUser !== null}
        user={formUser === 'new' || formUser === null ? undefined : formUser}
        onOpenChange={(open) => !open && setFormUser(null)}
      />

      <ResetPasswordDialog user={resetUser} onOpenChange={(open) => !open && setResetUser(null)} />

      <AlertDialog open={deactivateUser !== null} onOpenChange={(open) => !open && setDeactivateUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar {deactivateUser?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateUser?.id === me?.id
                ? 'Você vai perder o acesso e sair do sistema. Outro administrador pode reativar sua conta.'
                : 'A pessoa perde o acesso na hora e as sessões abertas são encerradas. Dá para reativar depois.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deactivateUser) void setActive(deactivateUser, false);
              }}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
