/**
 * Przeszyfrowuje zapisane tokeny na NOWY TOKEN_ENCRYPTION_KEY.
 *
 * Po co: klucz szyfruje tokeny Jiry i GitHuba w spoczynku. Wymiana samego
 * klucza osierociłaby istniejące wiersze — GCM nie zwraca wtedy zlej
 * odpowiedzi, tylko rzuca bledem, wiec integracje wygladalyby na zepsute
 * bez widocznego powodu. Ten skrypt odszyfrowuje starym kluczem i szyfruje
 * nowym, w jednej transakcji.
 *
 * Uzycie:
 *   npx tsx --env-file=.env.local scripts/rotate-token-encryption-key.ts <plik-z-nowym-kluczem>
 *
 * Stary klucz brany jest z TOKEN_ENCRYPTION_KEY w srodowisku, nowy z pliku
 * podanego argumentem — dzieki temu zadna wartosc nie przechodzi przez
 * argumenty procesu ani przez historie powloki.
 *
 * Bezpieczenstwo: nic nie jest zapisywane, dopoki KAZDY wiersz nie zostanie
 * odczytany nowym kluczem i porownany z oryginalem. Przy jakiejkolwiek
 * roznicy transakcja jest wycofywana. Skrypt nie wypisuje zadnego tokenu
 * ani klucza — tylko liczby.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { decryptToken, encryptToken } from "@/lib/crypto";

type Provider = "GITHUB" | "JIRA";
type Row = { id: string; owner_id: string; encrypted_token: string };

const TABLES: { table: string; provider: Provider }[] = [
  { table: "github_credential", provider: "GITHUB" },
  { table: "jira_credential", provider: "JIRA" },
];

const keyFile = process.argv[2];
if (!keyFile) {
  console.error("Podaj sciezke do pliku z nowym kluczem.");
  process.exit(1);
}

const oldKey = process.env.TOKEN_ENCRYPTION_KEY;
if (!oldKey) {
  console.error("Brak TOKEN_ENCRYPTION_KEY w srodowisku — to stary klucz, jest wymagany.");
  process.exit(1);
}

const newKey = readFileSync(keyFile, "utf8").trim();
if (Buffer.from(newKey, "base64").length !== 32) {
  console.error("Nowy klucz nie dekoduje sie do 32 bajtow — przerywam.");
  process.exit(1);
}
if (newKey === oldKey) {
  console.error("Nowy klucz jest identyczny ze starym — nie ma czego rotowac.");
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url || !/127\.0\.0\.1:54322|localhost:54322/.test(url)) {
  console.error("DATABASE_URL nie wskazuje na lokalna baze (127.0.0.1:54322) — przerywam.");
  process.exit(1);
}

const c = new Client({ connectionString: url });

(async () => {
  await c.connect();
  await c.query("begin");

  let total = 0;
  const plaintextByRow = new Map<string, string>();

  for (const { table, provider } of TABLES) {
    const { rows } = await c.query<Row>(
      `select id, owner_id, encrypted_token from ${table} order by id`,
    );
    for (const r of rows) {
      const plain = decryptToken(r.encrypted_token, { ownerId: r.owner_id, provider }, {
        TOKEN_ENCRYPTION_KEY: oldKey,
      });
      const reEncrypted = encryptToken(plain, { ownerId: r.owner_id, provider }, {
        TOKEN_ENCRYPTION_KEY: newKey,
      });
      await c.query(`update ${table} set encrypted_token = $1 where id = $2`, [reEncrypted, r.id]);
      plaintextByRow.set(`${table}:${r.id}`, plain);
      total += 1;
    }
    console.log(`  ${table.padEnd(20)} przeszyfrowano ${rows.length}`);
  }

  // Weryfikacja PRZED zatwierdzeniem: kazdy wiersz musi dac sie odczytac
  // nowym kluczem i zgadzac sie co do znaku z oryginalem.
  let verified = 0;
  for (const { table, provider } of TABLES) {
    const { rows } = await c.query<Row>(
      `select id, owner_id, encrypted_token from ${table} order by id`,
    );
    for (const r of rows) {
      const back = decryptToken(r.encrypted_token, { ownerId: r.owner_id, provider }, {
        TOKEN_ENCRYPTION_KEY: newKey,
      });
      if (back !== plaintextByRow.get(`${table}:${r.id}`)) {
        throw new Error(`Weryfikacja nie przeszla dla ${table}:${r.id}`);
      }
      verified += 1;
    }
  }

  if (verified !== total) {
    throw new Error(`Zweryfikowano ${verified} z ${total} wierszy — przerywam.`);
  }

  await c.query("commit");
  console.log(`\n  ✅ Zatwierdzone. Przeszyfrowanych i zweryfikowanych wierszy: ${total}`);
  console.log("  Teraz podmien TOKEN_ENCRYPTION_KEY w .env oraz .env.local.");
})()
  .catch(async (e) => {
    await c.query("rollback").catch(() => {});
    console.error("\n  ❌ WYCOFANE, baza bez zmian:", (e as Error).message);
    process.exitCode = 1;
  })
  .finally(() => c.end().catch(() => {}));
