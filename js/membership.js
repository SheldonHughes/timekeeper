// Group/membership operations -- all backed by Cloud Functions
// (functions/index.js) rather than direct Firestore writes, because
// deciding "who belongs to which group" is exactly the kind of check
// a client can't be trusted to self-report (see firestore.rules).

import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';
import { app } from './firebase-config.js';

const functions = getFunctions(app);

const whoAmIFn = httpsCallable(functions, 'whoAmI');
const createGroupFn = httpsCallable(functions, 'createGroup');
const joinGroupFn = httpsCallable(functions, 'joinGroup');
const regenerateInviteCodeFn = httpsCallable(functions, 'regenerateInviteCode');

// { role: 'superadmin' | 'admin' | 'rig' | null, ...profile fields }
export async function getMyIdentity() {
  const res = await whoAmIFn();
  return res.data;
}

export async function createGroup(name) {
  const res = await createGroupFn({ name });
  return res.data; // { groupId, name }
}

export async function joinGroup({ groupId, code, role, ...fields }) {
  const res = await joinGroupFn({ groupId, code, role, ...fields });
  return res.data; // { groupId, groupName }
}

export async function regenerateInviteCode({ groupId, role }) {
  const res = await regenerateInviteCodeFn({ groupId, role });
  return res.data; // { code }
}

// Parses ?join=rig&group=<id>&code=<code> (or join=admin) from the
// current URL -- both index.html and dashboard.html check this on
// load to decide whether to show a join screen.
export function parseInviteFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('join');
  const groupId = params.get('group');
  const code = params.get('code');
  if (!role || !groupId || !code || !['rig', 'admin'].includes(role)) return null;
  return { role, groupId, code };
}

export function inviteLink(page, { groupId, code, role }) {
  const url = new URL(page, window.location.href);
  url.search = new URLSearchParams({ join: role, group: groupId, code }).toString();
  return url.toString();
}
