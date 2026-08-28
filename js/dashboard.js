import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-functions.js';
import { app } from './firebase-config.js';
import { watchAuth, signIn, signOut, getAdminForCurrentUser } from './auth.js';
import {
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
    admin: null,
    authReady: false,
    error: '',

    activeTab: 'pending', // pending | all
    pendingJobs: [],
    allJobs: [],
    approvedJobs: [],
    rigs: [],
    hoursByJob: {},
    needsReassignmentEntries: [],
    reassignTargets: {},
    _unsubs: [],

    init() {
      watchAuth(async (user) => {
        this.authReady = true;
        this._teardown();
        this.user = user;
        if (!user) { this.admin = null; return; }

        const admin = await getAdminForCurrentUser(user);
        if (!admin) {
          this.error = 'This Google account is not registered as a supervisor/admin.';
          this.admin = null;
          return;
        }
        this.error = '';
        this.admin = admin;
        this._subscribe();
      });
    },

    _subscribe() {
      this._unsubs.push(listenPendingJobs((list) => {
        this.pendingJobs = list;
        list.forEach((job) => this._loadHours(job.id));
      }));
      this._unsubs.push(listenAllJobs((list) => { this.allJobs = list; }));
      this._unsubs.push(listenApprovedJobs((list) => { this.approvedJobs = list; }));
      this._unsubs.push(listenAllRigs((list) => { this.rigs = list; }));
      this._unsubs.push(listenNeedsReassignmentEntries((list) => { this.needsReassignmentEntries = list; }));
    },

    _teardown() {
      this._unsubs.forEach((fn) => fn && fn());
      this._unsubs = [];
    },

    async _loadHours(jobId) {
      if (jobId in this.hoursByJob) return;
      this.hoursByJob[jobId] = await getHoursLoggedForJob(jobId);
    },

    async signInAsAdmin() {
      this.error = '';
      try { await signIn(); } catch (e) { this.error = e.message; }
    },

    signOutAdmin() { signOut(); },

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
      try { await approveJob(job.id, this.admin.id); } catch (e) { this.error = e.message; }
    },

    async reject(job) {
      try { await rejectJob(job.id, this.admin.id); } catch (e) { this.error = e.message; }
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
