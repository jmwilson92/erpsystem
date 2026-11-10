import { cookies } from 'next/headers';
import { getSessionUser } from '../auth-core';
import { getCurrentUser } from '../auth';
/** Do not let an invalid session fall through to DEMO_MODE's public admin fallback. */
export async function helpIdentity() {
  const jar=await cookies();
  if(jar.get('forge-session')?.value) {
    const user=await getSessionUser();
    return user?.isActive?{user,demo:false}:null;
  }
  if(/^demo_[a-z0-9]{6,40}$/.test(jar.get('forge-demo')?.value || '')) {
    const user=await getCurrentUser();
    return user?.isActive?{user,demo:true}:null;
  }
  return null;
}
