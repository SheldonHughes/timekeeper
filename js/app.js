import { watchAuth, signIn, getRigForCurrentUser } from './auth.js';
import {
  listenRoster,
  listenApprovedJobs,
  listenOwnPendingJobs,
  listenActiveEntries,
  listenRecentEntriesForRig,
  listenTodayEntriesForRig,
  listenEntriesForRigJob,
  listenRig,
  setDefaultOperator,
  createJob,
  updateJobMeta,
  clockIn,
  clockOut,
  editEntryTime,
  setEntryNote,
} from './db.js';
import {
  formatElapsed,
  jobLabel,
  formatDayLabel,
  formatShortDate,
  formatClock,
  timeInputToDate,
  dateToTimeInput,
} from './utils.js';

document.addEventListener('alpine:init', () => {
  Alpine.data('tabletApp', () => ({
    // --- auth / identity ---
    user: null,
    rig: null,
    roster: [],
    authReady: false,
    rosterPickerOpen: false,

    // --- live data ---
    approvedJobs: [],
    ownPendingJobs: [],
    activeEntriesAll: [],
    recentEntriesForRig: [],
    todayEntriesForRig: [],
    previousEntries: [],

    // --- navigation ---
    screen: 'home', // home | switchJob | browseJobs | newJob | editJobMeta | actionSheet | noteScreen | editTimeScreen | previousEntries
    browseMode: 'select', // select | edit
    searchQuery: '',
    previousEntriesSearch: '',

    // --- working drafts ---
    newJobDraft: { ownerName: '', jobName: '' },
    editJobTarget: null,
    editJobDraft: { ownerName: '', jobName: '' },
    actionTargetJob: null,
    actionTargetEntry: null,
    noteDraft: '',
    editTimeDraft: { start: '', end: '' },
    previousEntriesJob: null,

    now: new Date(),
    error: '',
    saving: false,
    _unsubs: [],
    _longPressTimer: null,
    _longPressFired: false,

    init() {
      setInterval(() => { this.now = new Date(); }, 1000);

      watchAuth(async (user) => {
        this.authReady = true;
        this._teardown();
        this.user = user;
        if (!user) { this.rig = null; return; }

        const rig = await getRigForCurrentUser(user);
        if (!rig) {
          this.error = 'This Google account is not registered as a rig. Ask an admin to add it.';
          return;
        }
        this.error = '';
        this.rig = rig;
        this._subscribe();
      });
    },

    _subscribe() {
      const rigId = this.rig.id;
      this._unsubs.push(listenRig(rigId, (r) => { if (r) this.rig = r; }));
      this._unsubs.push(listenRoster((list) => { this.roster = list; }));
      this._unsubs.push(listenApprovedJobs((list) => { this.approvedJobs = list; }));
      this._unsubs.push(listenOwnPendingJobs(rigId, (list) => { this.ownPendingJobs = list; }));
      this._unsubs.push(listenActiveEntries((list) => { this.activeEntriesAll = list; }));
      this._unsubs.push(listenRecentEntriesForRig(rigId, (list) => { this.recentEntriesForRig = list; }));
      this._unsubs.push(listenTodayEntriesForRig(rigId, (list) => { this.todayEntriesForRig = list; }));
    },

    _teardown() {
      this._unsubs.forEach((fn) => fn && fn());
      this._unsubs = [];
    },

    async signInAsRig() {
      this.error = '';
      try { await signIn(); } catch (e) { this.error = e.message; }
    },

    // --- derived state ---

    get allVisibleJobs() {
      const seen = new Map();
      [...this.approvedJobs, ...this.ownPendingJobs].forEach((j) => seen.set(j.id, j));
      return [...seen.values()];
    },

    jobById(jobId) {
      return this.allVisibleJobs.find((j) => j.id === jobId) || null;
    },

    get myActiveEntry() {
      return this.activeEntriesAll.find((e) => e.rigId === this.rig?.id) || null;
    },

    get myActiveJob() {
      return this.myActiveEntry ? this.jobById(this.myActiveEntry.jobId) : null;
    },

    // jobId -> true if some *other* rig is currently clocked into it
    get activeJobIdsElsewhere() {
      const set = new Set();
      this.activeEntriesAll.forEach((e) => {
        if (e.rigId !== this.rig?.id) set.add(e.jobId);
      });
      return set;
    },

    // This rig's known jobs, most-recently-worked first, deduped.
    get knownJobs() {
      const order = [];
      const seen = new Set();
      this.recentEntriesForRig.forEach((e) => {
        if (!seen.has(e.jobId)) {
          seen.add(e.jobId);
          const job = this.jobById(e.jobId);
          if (job) order.push(job);
        }
      });
      return order;
    },

    // Today's entry for a given job on this rig, if any -- the target
    // for the long-press action sheet.
    todayEntryForJob(jobId) {
      return (
        this.todayEntriesForRig.find((e) => e.jobId === jobId && !e.clockOut) ||
        this.todayEntriesForRig
          .filter((e) => e.jobId === jobId)
          .sort((a, b) => b.clockIn.toMillis() - a.clockIn.toMillis())[0] ||
        null
      );
    },

    latestEntryForJob(jobId) {
      return this.todayEntryForJob(jobId) || this.recentEntriesForRig.find((e) => e.jobId === jobId) || null;
    },

    get filteredBrowseJobs() {
      const q = this.searchQuery.trim().toLowerCase();
      if (!q) return this.allVisibleJobs;
      return this.allVisibleJobs.filter(
        (j) => j.ownerName.toLowerCase().includes(q) || j.jobName.toLowerCase().includes(q)
      );
    },

    get filteredPreviousEntries() {
      const q = this.previousEntriesSearch.trim();
      if (!q) return this.previousEntries;
      return this.previousEntries.filter((e) => e.date.includes(q) || formatShortDate(e.date).toLowerCase().includes(q.toLowerCase()));
    },

    elapsedFor(entry) {
      if (!entry) return '0:00:00';
      return formatElapsed(entry.clockIn.toDate(), this.now);
    },

    editContext() {
      return { editedByRigId: this.rig.id, editedByOperatorName: this.rig.defaultOperatorName || '' };
    },

    // --- navigation actions ---

    goHome() { this.screen = 'home'; this.error = ''; },

    openSwitchJob() { this.screen = 'switchJob'; },

    openBrowseJobs(mode) {
      this.browseMode = mode;
      this.searchQuery = '';
      this.screen = 'browseJobs';
    },

    openNewJob() {
      this.newJobDraft = { ownerName: '', jobName: '' };
      this.screen = 'newJob';
    },

    openEditJobMeta(job) {
      this.editJobTarget = job;
      this.editJobDraft = { ownerName: job.ownerName, jobName: job.jobName };
      this.screen = 'editJobMeta';
    },

    openActionSheetFor(job) {
      const entry = this.latestEntryForJob(job.id);
      if (!entry) return;
      this.actionTargetJob = job;
      this.actionTargetEntry = entry;
      this.screen = 'actionSheet';
    },

    openNoteScreen() {
      this.noteDraft = this.actionTargetEntry?.note || '';
      this.screen = 'noteScreen';
    },

    openEditTimeScreen() {
      const e = this.actionTargetEntry;
      this.editTimeDraft = {
        start: dateToTimeInput(e.clockIn.toDate()),
        end: e.clockOut ? dateToTimeInput(e.clockOut.toDate()) : '',
      };
      this.screen = 'editTimeScreen';
    },

    openPreviousEntries() {
      this.previousEntriesJob = this.actionTargetJob;
      this.previousEntriesSearch = '';
      this.previousEntries = [];
      const unsub = listenEntriesForRigJob(this.rig.id, this.previousEntriesJob.id, (list) => {
        this.previousEntries = list;
      });
      this._unsubs.push(unsub);
      this.screen = 'previousEntries';
    },

    // --- long press (row long-press opens the action sheet) ---

    startLongPress(job) {
      clearTimeout(this._longPressTimer);
      this._longPressFired = false;
      this._longPressTimer = setTimeout(() => {
        this._longPressFired = true;
        this.openActionSheetFor(job);
      }, 500);
    },

    cancelLongPress() {
      clearTimeout(this._longPressTimer);
    },

    // The click that follows a long-press's pointerup shouldn't also
    // fire the row's normal tap action (switch job / open sheet again).
    handleRowTap(job, currentJobId) {
      if (this._longPressFired) { this._longPressFired = false; return; }
      if (job.id === currentJobId) this.openActionSheetFor(job);
      else this.switchToJob(job);
    },

    // --- job selection / clock in / switch ---

    async selectJobFromBrowse(job) {
      if (this.browseMode === 'edit') {
        this.openEditJobMeta(job);
      } else {
        await this.switchToJob(job);
      }
    },

    async switchToJob(job) {
      if (this.myActiveEntry && this.myActiveEntry.jobId === job.id) {
        this.goHome();
        return;
      }
      this.saving = true;
      try {
        if (this.myActiveEntry) {
          await clockOut(this.myActiveEntry.id);
        }
        await clockIn({
          rigId: this.rig.id,
          jobId: job.id,
          operatorName: this.rig.defaultOperatorName || '',
          jobStatusAtEntry: job.status,
        });
        this.goHome();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    },

    async clockOutCurrent() {
      if (!this.myActiveEntry) return;
      this.saving = true;
      try {
        await clockOut(this.myActiveEntry.id);
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    },

    // --- forms ---

    async submitNewJob() {
      if (!this.newJobDraft.ownerName.trim() || !this.newJobDraft.jobName.trim()) return;
      this.saving = true;
      try {
        const ref = await createJob({
          ownerName: this.newJobDraft.ownerName.trim(),
          jobName: this.newJobDraft.jobName.trim(),
          createdByRigId: this.rig.id,
          createdByOperatorName: this.rig.defaultOperatorName || '',
        });
        // Creator can clock in immediately -- approval doesn't block work.
        await this.switchToJob({ id: ref.id, status: 'pending' });
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    },

    async saveEditJobMeta() {
      if (!this.editJobDraft.ownerName.trim() || !this.editJobDraft.jobName.trim()) return;
      this.saving = true;
      try {
        await updateJobMeta(
          this.editJobTarget,
          { ownerName: this.editJobDraft.ownerName.trim(), jobName: this.editJobDraft.jobName.trim() },
          this.editContext()
        );
        this.goHome();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    },

    async saveNote() {
      this.saving = true;
      try {
        await setEntryNote(this.actionTargetEntry, this.noteDraft.trim(), this.editContext());
        this.goHome();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    },

    async saveEditTime() {
      const entry = this.actionTargetEntry;
      const base = entry.clockIn.toDate();
      const newClockIn = timeInputToDate(base, this.editTimeDraft.start);
      const newClockOut = this.editTimeDraft.end ? timeInputToDate(base, this.editTimeDraft.end) : null;
      this.saving = true;
      try {
        await editEntryTime(entry, { newClockIn, newClockOut }, this.editContext());
        this.goHome();
      } catch (e) {
        this.error = e.message;
      } finally {
        this.saving = false;
      }
    },

    async pickOperator(name) {
      this.rosterPickerOpen = false;
      if (name === this.rig.defaultOperatorName) return;
      try { await setDefaultOperator(this.rig.id, name); } catch (e) { this.error = e.message; }
    },

    // --- formatting passthroughs for the template ---
    jobLabel,
    formatDayLabel,
    formatShortDate,
    formatClock,
  }));
});
