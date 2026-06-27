import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const currentDir = dirname(fileURLToPath(import.meta.url));
const envPaths = [
  resolve(currentDir, '../.env'),
  resolve(currentDir, '../.env.prod'),
  resolve(currentDir, '../../../apps/web/.env.local'),
  resolve(process.cwd(), '.env'),
];

for (const envPath of envPaths) {
  if (process.env.DATABASE_URL) {
    break;
  }

  config({ path: envPath });
}

type FakeUser = {
  name: string;
  email: string;
  username: string;
};

const fakeUsers: FakeUser[] = [
  {
    name: 'Amy Chen',
    email: 'amy_chen+seed@parlayrace.dev',
    username: 'amy_chen',
  },
  {
    name: 'Mateo Silva',
    email: 'mateo_silva+seed@parlayrace.dev',
    username: 'mateo_silva',
  },
  {
    name: 'Nora Patel',
    email: 'nora_patel+seed@parlayrace.dev',
    username: 'nora_patel',
  },
  {
    name: 'Jules Park',
    email: 'jules_park+seed@parlayrace.dev',
    username: 'jules_park',
  },
  {
    name: 'Luca Romero',
    email: 'luca_romero+seed@parlayrace.dev',
    username: 'luca_romero',
  },
  {
    name: 'Sofia Kim',
    email: 'sofia_kim+seed@parlayrace.dev',
    username: 'sofia_kim',
  },
  {
    name: 'Kai Thompson',
    email: 'kai_thompson+seed@parlayrace.dev',
    username: 'kai_thompson',
  },
  {
    name: 'Mina Okafor',
    email: 'mina_okafor+seed@parlayrace.dev',
    username: 'mina_okafor',
  },
  {
    name: 'Noah Rivera',
    email: 'noah_rivera+seed@parlayrace.dev',
    username: 'noah_rivera',
  },
  {
    name: 'Zoe Bennett',
    email: 'zoe_bennett+seed@parlayrace.dev',
    username: 'zoe_bennett',
  },
];

const seed = async () => {
  const { db } = await import('./db.ts');
  const { user, userProfile } = await import('./schema.ts');

  const now = new Date();
  const emails = fakeUsers.map((entry) => entry.email);

  await db
    .insert(user)
    .values(
      fakeUsers.map((entry) => ({
        name: entry.name,
        email: entry.email,
        emailVerified: true,
      }))
    )
    .onConflictDoUpdate({
      target: user.email,
      set: {
        emailVerified: true,
        updatedAt: now,
      },
    });

  const seededUsers = await db.query.user.findMany({
    where: (table, { inArray: whereInArray }) =>
      whereInArray(table.email, emails),
    columns: {
      id: true,
      email: true,
    },
  });

  const usernameByEmail = new Map<string, string>(
    fakeUsers.map((entry) => [entry.email, entry.username])
  );

  const upserts: Array<{ id: string; username: string }> = [];
  for (const entry of seededUsers) {
    const username = usernameByEmail.get(entry.email);
    if (!username) {
      continue;
    }

    upserts.push({
      id: entry.id,
      username,
    });
  }

  if (upserts.length > 0) {
    await db
      .insert(userProfile)
      .values(upserts)
      .onConflictDoUpdate({
        target: userProfile.id,
        set: {
          updatedAt: now,
        },
      });
  }

  const usernames = upserts.map((entry) => entry.username);
  const profileCount = usernames.length
    ? await db.query.userProfile.findMany({
        where: (table, { inArray: whereInArray }) =>
          whereInArray(table.username, usernames),
        columns: {
          id: true,
        },
      })
    : [];

  console.log(`Seeded ${seededUsers.length} fake users.`);
  console.log(`Seeded ${profileCount.length} user profiles.`);
};

seed()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
  });
