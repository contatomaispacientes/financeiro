import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // process.env (e não env()) para o `prisma generate` rodar sem banco, como no CI e em clone novo.
    // migrate/introspect continuam exigindo a URL.
    url: process.env['DATABASE_URL'],
  },
});
