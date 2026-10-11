import { backend, unavailable } from '../../../../server/backend';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(request: Request) {
  try {
    return await backend().identity.handler(request);
  } catch {
    return unavailable();
  }
}
export const GET = handle;
export const POST = handle;
