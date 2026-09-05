import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';
import { app } from './firebase-config.js';
import { watchAuth, signIn, signOut } from './auth.js';
import { getMyIdentity, createGroup, joinGroup, regenerateInviteCode, parseInviteFromUrl, inviteLink } from './membership.js';
import {
  listenGroup,
  listenAllGroups,
  listenPendingJobs,
  listenAllJobs,
  listenAllRigs,
  listenNeedsReassignmentEntries,
  listenApprovedJobs,
  getHoursLoggedForJob,
  approveJob,
  rejectJob,
} from './db.js';
import { timeAgo, jobLabel } from './utils.js';

const functions = getFunctions(app);
const reassignTimeEntryFn = httpsCallable(functions, 'reassignTimeEntry');

document.addEventListener('alpine:init', () => {
  Alpine.data('dashboardApp', () => ({
    user: null,
    identity: null, // { role: 'superadmin' | 'admin' | 'rig' | null, ... }
    authReady: false,
    error: '',

    // superadmin only: which group they're currently acting on
    allGroups: [],
    selectedGroupId: null,

    // create/join a group (identity.role === null)
    pendingInvite: null,
    createDraft: { name: '' },
    joinDraft: { name: '' },
    working: false,

    group: null, // the effective group's doc (name + invite codes)
    activeTab: 'pending', // pending | all
    pendingJobs: [],
    allJobs: [],
    approvedJobs: [],
    rigs: [],
    hoursByJob: {},
    needsReassignmentEntries: [],
    reassignTargets: {},
    linkCopiedFor: '',
    _unsubs: [],
    _groupUnsubs: [],

    init() {
      this.pendingInvite = parseInviteFromUrl();

      watchAuth(async (user) => {
        this.authReady = true;
        this._teardown();
        this.user = user;
        this.identity = null;
        if (!user) return;
        await this.loadIdentity();
      });
    },

    async loadIdentity() {
      this.error = '';
      try {
        this.identity = await getMyIdentity();
      } catch (e) {
        this.error = e.message;
        return;
      }

      if (this.identity.role === 'superadmin') {
        this._unsubs.push(listenAllGroups((list) => { this.allGroups = list; }));
      } else if (this.identity.role === 'admin') {
        this._subscribeToGroup(this.identity.groupId);
      }
      // role === 'rig': template shows a "wrong account" message.
      // role === null: template shows join-or-create, depending on pendingInvite.
    },

    get effectiveGroupId() {
      if (this.identity?.role === 'admin') return this.identity.groupId;
      if (this.identity?.role === 'superadmin') return this.selectedGroupId;
      return null;
    },

    selectGroup(groupId) {
      this.selectedGroupId = groupId;
      this._subscribeToGroup(groupId);
    },

    backToGroupPicker() {
      this._groupUnsubs.forEach((fn) => fn && fn());
      this._groupUnsubs = [];
      this.selectedGroupId = null;
      this.group = null;
    },

    _subscribeToGroup(groupId) {
      this._groupUnsubs.forEach((fn) => fn && fn());
      this._groupUnsubs = [];
      this.hoursByJob = {};
      this._groupUnsubs.push(listenGroup(groupId, (g) => { this.group = g; }));
      this._groupUnsubs.push(listenPendingJobs(groupId, (list) => {
        this.pendingJobs = list;
        list.forEach((job) => this._loadHours(job.id));
      }));
      this._groupUnsubs.push(listenAllJobs(groupId, (list) => { this.allJobs = list; }));
      this._groupUnsubs.push(listenApprovedJobs(groupId, (list) => { this.approvedJobs = list; }));
      this._groupUnsubs.push(listenAllRigs(groupId, (list) => { this.rigs = list; }));
      this._groupUnsubs.push(listenNeedsReassignmentEntries(groupId, (list) => { this.needsReassignmentEntries = list; }));
    },

    _teardown() {
      this._unsubs.forEach((fn) => fn && fn());
      this._unsubs = [];
      this._groupUnsubs.forEach((fn) => fn && fn());
      this._groupUnsubs = [];
    },

    async _loadHours(jobId) {
      if (jobId in this.hoursByJob) return;
      this.hoursByJob[jobId] = await getHoursLoggedForJob(this.effectiveGroupId, jobId);
    },

    async signInAsAdmin() {
      this.error = '';
      try { await signIn(); } catch (e) { this.error = e.message; }
    },

    signOutAdmin() { signOut(); },

    async submitCreateGroup() {
      if (!this.createDraft.name.trim()) return;
      this.working = true;
      this.error = '';
      try {
        await createGroup(this.createDraft.name.trim());
        await this.loadIdentity();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.working = false;
      }
    },

    async submitJoinAsAdmin() {
      if (!this.pendingInvite || this.pendingInvite.role !== 'admin') return;
      this.working = true;
      this.error = '';
      try {
        await joinGroup({ groupId: this.pendingInvite.groupId, code: this.pendingInvite.code, role: 'admin' });
        await this.loadIdentity();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.working = false;
      }
    },

    async copyInviteLink(role) {
      if (!this.group) return;
      const code = role === 'rig' ? this.group.rigInviteCode : this.group.adminInviteCode;
      const page = role === 'rig' ? 'index.html' : 'dashboard.html';
      const url = inviteLink(page, { groupId: this.effectiveGroupId, code, role });
      try {
        await navigator.clipboard.writeText(url);
        this.linkCopiedFor = role;
        setTimeout(() => { if (this.linkCopiedFor === role) this.linkCopiedFor = ''; }, 2000);
      } catch (e) {
        this.error = 'Could not copy to clipboard: ' + e.message;
      }
    },

    async regenerateLink(role) {
      this.working = true;
      try {
        await regenerateInviteCode({ groupId: this.effectiveGroupId, role });
      } catch (e) {
        this.error = e.message;
      } finally {
        this.working = false;
      }
    },

    rigLabel(rigId) {
      return this.rigs.find((r) => r.id === rigId)?.label || rigId;
    },

    jobById(jobId) {
      return this.allJobs.find((j) => j.id === jobId) || null;
    },

    get jobsForTab() {
      return this.activeTab === 'pending' ? this.pendingJobs : this.allJobs;
    },

    async approve(job) {
      try { await approveJob(job.id, this.user.uid); } catch (e) { this.error = e.message; }
    },

    async reject(job) {
      try { await rejectJob(job.id, this.user.uid); } catch (e) { this.error = e.message; }
    },

    async submitReassign(entry) {
      const newJobId = this.reassignTargets[entry.id];
      if (!newJobId) return;
      try {
        await reassignTimeEntryFn({ entryId: entry.id, newJobId });
      } catch (e) {
        this.error = e.message;
      }
    },

    jobLabel,
    timeAgo,
    entryTimeAgo(entry) { return timeAgo(entry.clockIn.toDate()); },
    jobTimeAgo(job) { return job.createdAt ? timeAgo(job.createdAt.toDate()) : ''; },
  }));
});
