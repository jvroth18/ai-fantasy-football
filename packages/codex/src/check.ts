import { CodexAppServerClient } from './client.js';

async function main(): Promise<void> {
  const cwd = process.cwd();
  const client = await CodexAppServerClient.launch({ cwd });
  try {
    const status = await client.readiness(cwd);
    console.log(
      JSON.stringify(
        {
          authenticated: status.authenticated,
          accountKind: status.accountKind,
          modelCount: status.models.length,
          skillCount: status.skills.length,
          computerUseAvailable: status.computerUseAvailable,
          readyForDecisions: status.readyForDecisions,
          readyForEspn: status.readyForEspn,
          issues: status.issues,
        },
        null,
        2,
      ),
    );
    if (!status.readyForDecisions) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
