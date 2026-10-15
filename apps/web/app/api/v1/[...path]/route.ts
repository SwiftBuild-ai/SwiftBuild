import { proxyBackend } from '../../../../server/backend';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const handle = proxyBackend;
export const GET = handle;
export const POST = handle;
export const PUT = handle;
