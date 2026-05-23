const STORAGE_KEY = "trip-settlement-records-v1";
const DAILY_ALLOWANCE = 180;

const expenseTypes = [
  { value: "meal", label: "共同餐饮" },
  { value: "transport", label: "共同交通" },
];

const vehicleTypes = {
  none: { label: "不开车", allowance: 0 },
  ev: { label: "新能源车", allowance: 150 },
  fuel: { label: "油车", allowance: 250 },
};

const transportModes = {
  none: { label: "未选择", reimbursable: false },
  selfDrive: { label: "自驾", reimbursable: false },
  train: { label: "火车", reimbursable: true },
  flight: { label: "飞机", reimbursable: true },
};

const reportStatuses = {
  pending: { label: "未填报", className: "pending" },
  partial: { label: "待补充", className: "pending" },
  traveled: { label: "已出差", className: "done" },
  absent: { label: "实际未出差", className: "absent" },
};

const state = {
  trips: [],
  selectedId: "",
  query: "",
  toast: "",
  exportFile: null,
  cloudStatus: "",
  cloudStatusTripId: "",
};

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateRange(start, end) {
  if (!start && !end) return "未填写";
  if (!start) return `至 ${end}`;
  if (!end) return `${start} 起`;
  return `${start} 至 ${end}`;
}

function parseDate(date) {
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function naturalDays(start, end) {
  const startDate = parseDate(start);
  const endDate = parseDate(end);
  if (!startDate || !endDate) return 0;
  const ms = endDate.getTime() - startDate.getTime();
  if (ms < 0) return 0;
  return Math.floor(ms / 86400000) + 1;
}

function splitNames(value) {
  return String(value || "")
    .split(/[，,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeTrip(trip) {
  trip.plan ||= {};
  trip.plan.owner ||= "";
  trip.expenses ||= [];
  trip.cloudId ||= "";
  if (!Array.isArray(trip.memberReports)) {
    const legacyPeople = unique(splitNames(trip.actual?.peopleText));
    trip.memberReports = legacyPeople.map((name) => ({
      id: uid(),
      name,
      destination: trip.actual?.destination || "",
      startDate: trip.actual?.startDate || "",
      endDate: trip.actual?.endDate || "",
      status: trip.actual?.startDate && trip.actual?.endDate ? "traveled" : "pending",
      transportMode: "none",
      ticketAmount: 0,
      ticketBuyer: "",
      drives: false,
      vehicleType: "none",
      note: trip.actual?.note || "",
    }));
  }
  delete trip.actual;
  syncPlannedReports(trip);
  migrateVehicleExpenses(trip);
  trip.memberReports.forEach(normalizeReport);
  trip.expenses = trip.expenses.filter((expense) =>
    expenseTypes.some((type) => type.value === expense.type),
  );
  return trip;
}

function normalizeReport(report) {
  if (!report.status) {
    report.status = report.startDate && report.endDate ? "traveled" : "pending";
  }
  if (!reportStatuses[report.status]) report.status = "pending";
  if (report.status === "absent") {
    report.startDate = "";
    report.endDate = "";
    report.destination = "";
    report.drives = false;
    report.vehicleType = "none";
    report.transportMode = "none";
    report.ticketAmount = 0;
    report.ticketBuyer = "";
  }
  report.transportMode ||= report.drives ? "selfDrive" : "none";
  if (!transportModes[report.transportMode]) report.transportMode = "none";
  if (report.transportMode === "selfDrive") report.drives = true;
  if (report.transportMode === "train" || report.transportMode === "flight") {
    report.drives = false;
    report.vehicleType = "none";
  }
  report.ticketAmount = Number(report.ticketAmount || 0);
  report.ticketBuyer ||= "";
  report.drives = Boolean(report.drives);
  report.vehicleType = report.drives ? report.vehicleType || "ev" : "none";
  if (!vehicleTypes[report.vehicleType]) report.vehicleType = "none";
  return report;
}

function migrateVehicleExpenses(trip) {
  (trip.expenses || [])
    .filter((expense) => expense.type === "ev" || expense.type === "fuel")
    .forEach((expense) => {
      const report = findReport(trip, expense.payer);
      if (!report) return;
      report.drives = true;
      report.vehicleType = expense.type;
      report.transportMode = "selfDrive";
    });
}

function syncPlannedReports(trip) {
  const existing = new Set((trip.memberReports || []).map((report) => report.name));
  planPeople(trip).forEach((name) => {
    if (!existing.has(name)) {
      trip.memberReports.push({
        id: uid(),
        name,
        destination: "",
        startDate: "",
        endDate: "",
        status: "pending",
        transportMode: "none",
        ticketAmount: 0,
        ticketBuyer: "",
        drives: false,
        vehicleType: "none",
        note: "",
      });
    }
  });
}

function expenseLabel(type) {
  return expenseTypes.find((item) => item.value === type)?.label || type;
}

function createEmptyTrip() {
  return {
    id: uid(),
    title: "新的出差记录",
    plan: {
      owner: "",
      destination: "",
      startDate: "",
      endDate: "",
      peopleText: "",
      note: "",
    },
    memberReports: [],
    expenses: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function sampleTrips() {
  return [
    {
      id: uid(),
      title: "华东客户拜访",
      plan: {
        owner: "张三",
        destination: "上海、杭州",
        startDate: "2026-05-10",
        endDate: "2026-05-12",
        peopleText: "张三，李四，王五",
        note: "计划拜访上海和杭州客户。",
      },
      memberReports: [
        {
          id: uid(),
          name: "张三",
          destination: "上海、杭州、苏州",
          startDate: "2026-05-10",
          endDate: "2026-05-13",
          status: "traveled",
          transportMode: "selfDrive",
          ticketAmount: 0,
          ticketBuyer: "",
          drives: true,
          vehicleType: "ev",
          note: "实际新增苏州客户现场沟通。",
        },
        {
          id: uid(),
          name: "李四",
          destination: "上海、杭州",
          startDate: "2026-05-10",
          endDate: "2026-05-13",
          status: "traveled",
          transportMode: "train",
          ticketAmount: 428,
          ticketBuyer: "莉欣",
          drives: false,
          vehicleType: "none",
          note: "按计划参加客户拜访。",
        },
        {
          id: uid(),
          name: "王五",
          destination: "上海、杭州、苏州",
          startDate: "2026-05-10",
          endDate: "2026-05-13",
          status: "traveled",
          transportMode: "selfDrive",
          ticketAmount: 0,
          ticketBuyer: "",
          drives: true,
          vehicleType: "fuel",
          note: "苏州段负责技术交流。",
        },
        {
          id: uid(),
          name: "赵六",
          destination: "苏州",
          startDate: "2026-05-12",
          endDate: "2026-05-13",
          status: "traveled",
          transportMode: "flight",
          ticketAmount: 760,
          ticketBuyer: "公司",
          drives: false,
          vehicleType: "none",
          note: "临时加入苏州客户现场。",
        },
      ],
      expenses: [
        {
          id: uid(),
          date: "2026-05-10",
          type: "meal",
          amount: 480,
          payer: "张三",
          participants: ["张三", "李四", "王五", "赵六"],
          note: "客户晚餐",
        },
        {
          id: uid(),
          date: "2026-05-11",
          type: "transport",
          amount: 120,
          payer: "李四",
          participants: ["张三", "李四"],
          note: "打车到客户现场",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
}

function loadTrips() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return sampleTrips();
  try {
    const trips = JSON.parse(raw);
    return Array.isArray(trips) ? trips.map(normalizeTrip) : sampleTrips();
  } catch {
    return sampleTrips();
  }
}

function saveTrips(tripId = state.selectedId) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
  queueCloudSave(tripId);
}

function setCloudStatus(trip, message) {
  state.cloudStatus = message;
  state.cloudStatusTripId = trip?.id || "";
}

function getCloudStatus(trip) {
  return state.cloudStatusTripId === trip?.id ? state.cloudStatus : "";
}

function getSelectedTrip() {
  return state.trips.find((trip) => trip.id === state.selectedId) || state.trips[0];
}

function actualPeople(trip) {
  return unique(
    (trip.memberReports || [])
      .filter((report) => report.name && isTraveledReport(report))
      .map((report) => report.name),
  );
}

function planPeople(trip) {
  return unique(splitNames(trip.plan.peopleText));
}

function reportPeople(trip) {
  return unique((trip.memberReports || []).map((report) => report.name));
}

function actualReports(trip) {
  return (trip.memberReports || []).filter((report) => report.name && isTraveledReport(report));
}

function findReport(trip, name) {
  return (trip.memberReports || []).find((report) => report.name === name);
}

function reportStatus(report) {
  if (!report) return "pending";
  if (report.status === "absent") return "absent";
  if (hasActualDates(report)) {
    return hasCompleteTransport(report) ? "traveled" : "partial";
  }
  if (report.status === "traveled") return "partial";
  return "pending";
}

function isTraveledReport(report) {
  return hasActualDates(report) && report.status !== "absent";
}

function reportStatusLabel(report) {
  return reportStatuses[reportStatus(report)]?.label || "未填报";
}

function reportStatusClass(report) {
  return reportStatuses[reportStatus(report)]?.className || "pending";
}

function transportLabel(mode) {
  return transportModes[mode]?.label || "未选择";
}

function hasTicketTransport(report) {
  return report?.transportMode === "train" || report?.transportMode === "flight";
}

function hasActualDates(report) {
  return Boolean(report?.startDate && report?.endDate);
}

function hasCompleteTransport(report) {
  if (!report || report.status === "absent") return true;
  if (report.transportMode === "selfDrive") {
    return report.drives && report.vehicleType !== "none";
  }
  if (hasTicketTransport(report)) {
    return Number(report.ticketAmount || 0) > 0 && Boolean(report.ticketBuyer);
  }
  return false;
}

function ticketTransportTotal(trip) {
  return actualReports(trip).reduce((sum, report) => {
    if (!hasTicketTransport(report)) return sum;
    return sum + Number(report.ticketAmount || 0);
  }, 0);
}

function plannedReports(trip) {
  return planPeople(trip)
    .map((name) => findReport(trip, name))
    .filter(Boolean);
}

function pendingPlannedReports(trip) {
  return plannedReports(trip).filter((report) => {
    const status = reportStatus(report);
    return status !== "traveled" && status !== "absent";
  });
}

function incompleteTempReports(trip) {
  const planned = planPeople(trip);
  return (trip.memberReports || []).filter(
    (report) => {
      if (!report.name || planned.includes(report.name)) return false;
      const status = reportStatus(report);
      return status !== "traveled" && status !== "absent";
    },
  );
}

function completionStats(trip) {
  const planned = plannedReports(trip);
  const pending = pendingPlannedReports(trip);
  const absent = planned.filter((report) => reportStatus(report) === "absent");
  const traveled = planned.filter((report) => isTraveledReport(report));
  return {
    planned: planned.length,
    completed: planned.length - pending.length,
    pending: pending.length,
    absent: absent.length,
    traveled: traveled.length,
    allDone: planned.length > 0 && pending.length === 0,
  };
}

function tripActualStart(trip) {
  const dates = actualReports(trip).map((report) => report.startDate).sort();
  return dates[0] || "";
}

function tripActualEnd(trip) {
  const dates = actualReports(trip).map((report) => report.endDate).sort();
  return dates.at(-1) || "";
}

function actualDestination(trip) {
  return unique(
    actualReports(trip).flatMap((report) => splitNames(report.destination)),
  ).join("、");
}

function actualNote(trip) {
  return actualReports(trip)
    .map((report) => `${report.name}：${report.note || "无"}`)
    .join("；");
}

function calculateSettlement(trip) {
  const people = actualPeople(trip);
  const rows = people.map((name) => {
    const report = findReport(trip, name);
    const days = naturalDays(report?.startDate, report?.endDate);
    return {
      name,
      days,
      destination: report?.destination || "",
      transportMode: report?.transportMode || "none",
      ticketAmount: hasTicketTransport(report) ? Number(report.ticketAmount || 0) : 0,
      ticketBuyer: hasTicketTransport(report) ? report.ticketBuyer || "" : "",
      base: days * DAILY_ALLOWANCE,
      sharedDeduction: 0,
      advanceReceivable: 0,
      vehicleReceivable: 0,
      finalAmount: days * DAILY_ALLOWANCE,
    };
  });
  const byName = new Map(rows.map((row) => [row.name, row]));

  trip.expenses.forEach((expense) => {
    const amount = Number(expense.amount) || 0;
    const participants = unique(expense.participants || []).filter((name) =>
      byName.has(name),
    );
    if (!amount || participants.length === 0) return;
    const share = amount / participants.length;
    participants.forEach((name) => {
      byName.get(name).sharedDeduction += share;
    });
    if (byName.has(expense.payer)) {
      byName.get(expense.payer).advanceReceivable += amount;
    }
  });

  actualReports(trip).forEach((report) => {
    if (!report.drives || !vehicleTypes[report.vehicleType]) return;
    const amount = vehicleTypes[report.vehicleType].allowance;
    if (!amount || !byName.has(report.name)) return;
    const participants = people.filter((name) => name !== report.name);
    if (participants.length > 0) {
      const share = amount / participants.length;
      participants.forEach((name) => {
        byName.get(name).sharedDeduction += share;
      });
    }
    byName.get(report.name).vehicleReceivable += amount;
  });

  rows.forEach((row) => {
    row.finalAmount =
      row.base - row.sharedDeduction + row.advanceReceivable + row.vehicleReceivable;
  });

  return rows;
}

function totals(trip) {
  const settlement = calculateSettlement(trip);
  const expenseTotal = trip.expenses.reduce(
    (sum, expense) => sum + Number(expense.amount || 0),
    0,
  );
  const vehicleTotal = actualReports(trip).reduce((sum, report) => {
    if (!report.drives || !vehicleTypes[report.vehicleType]) return sum;
    return sum + vehicleTypes[report.vehicleType].allowance;
  }, 0);
  const ticketTotal = ticketTransportTotal(trip);
  return {
    days: actualReports(trip).reduce(
      (sum, report) => sum + naturalDays(report.startDate, report.endDate),
      0,
    ),
    people: actualPeople(trip).length,
    expenseTotal,
    vehicleTotal,
    ticketTotal,
    finalTotal: settlement.reduce((sum, row) => sum + row.finalAmount, 0),
  };
}

function diffRows(trip) {
  const planDays = naturalDays(trip.plan.startDate, trip.plan.endDate);
  const actualDays = naturalDays(tripActualStart(trip), tripActualEnd(trip));
  const planned = planPeople(trip);
  const actual = actualPeople(trip);
  const addedPeople = actual.filter((name) => !planned.includes(name));
  const removedPeople = planned.filter((name) => !actual.includes(name));

  const dateDiff =
    planDays === actualDays
      ? "无明显偏差"
      : actualDays > planDays
        ? `增加 ${actualDays - planDays} 天`
        : `减少 ${planDays - actualDays} 天`;
  const peopleDiff = [
    addedPeople.length ? `新增 ${addedPeople.join("、")}` : "",
    removedPeople.length ? `减少 ${removedPeople.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("；");

  return [
    {
      item: "出差日期",
      plan: dateRange(trip.plan.startDate, trip.plan.endDate),
      actual: dateRange(tripActualStart(trip), tripActualEnd(trip)),
      diff: dateDiff,
    },
    {
      item: "目的地",
      plan: trip.plan.destination || "未填写",
      actual: actualDestination(trip) || "未填写",
      diff:
        trip.plan.destination === actualDestination(trip)
          ? "无明显偏差"
          : "目的地有变化",
    },
    {
      item: "人员",
      plan: planned.join("、") || "未填写",
      actual: actual.join("、") || "未填写",
      diff: peopleDiff || "无明显偏差",
    },
    {
      item: "备注",
      plan: trip.plan.note || "无",
      actual: actualNote(trip) || "无",
      diff: actualNote(trip) ? "见成员填报备注" : "无",
    },
  ];
}

function signedDayDiff(actualDays, plannedDays) {
  if (!actualDays && !plannedDays) return "无日期";
  if (!actualDays) return "未出差";
  if (actualDays === plannedDays) return "无变化";
  return actualDays > plannedDays
    ? `+${actualDays - plannedDays} 天`
    : `-${plannedDays - actualDays} 天`;
}

function tripDateOverview(trip) {
  const planned = planPeople(trip);
  const planDays = naturalDays(trip.plan.startDate, trip.plan.endDate);
  const actual = actualReports(trip);
  const actualDays = actual.reduce(
    (sum, report) => sum + naturalDays(report.startDate, report.endDate),
    0,
  );
  return {
    planDays,
    planPeople: planned.length,
    planPersonDays: planned.length * planDays,
    actualStart: tripActualStart(trip),
    actualEnd: tripActualEnd(trip),
    actualPeople: actualPeople(trip).length,
    actualPersonDays: actualDays,
    dayDiff: signedDayDiff(
      naturalDays(tripActualStart(trip), tripActualEnd(trip)),
      planDays,
    ),
    personDayDiff: actualDays - planned.length * planDays,
  };
}

function memberDateRows(trip) {
  const planned = planPeople(trip);
  const names = unique([...planned, ...reportPeople(trip)]);
  const planDays = naturalDays(trip.plan.startDate, trip.plan.endDate);
  return names.map((name) => {
    const report = findReport(trip, name);
    const status = reportStatus(report);
    const actualDays = isTraveledReport(report)
      ? naturalDays(report.startDate, report.endDate)
      : 0;
    return {
      name,
      report,
      planned: planned.includes(name),
      status,
      statusLabel: reportStatusLabel(report),
      statusClass: reportStatusClass(report),
      planDate: planned.includes(name)
        ? dateRange(trip.plan.startDate, trip.plan.endDate)
        : "临时加入",
      actualDate:
        status === "absent"
          ? "实际未出差"
          : isTraveledReport(report)
            ? dateRange(report.startDate, report.endDate)
            : "未填写",
      actualDays,
      diff:
        status === "pending"
          ? "待跟进"
          : status === "partial"
            ? "待补充"
            : status === "absent"
              ? `-${planDays} 天`
              : signedDayDiff(actualDays, planned.includes(name) ? planDays : 0),
    };
  });
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 1800);
}

function tripLink(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("trip", id);
  return url.toString();
}

async function apiTrip(method, payload) {
  const url = new URL("/.netlify/functions/trip", window.location.origin);
  if (method === "GET") url.searchParams.set("id", payload.id);
  const response = await fetch(url, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : {},
    body: method === "POST" ? JSON.stringify(payload) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "云端任务请求失败");
  return data;
}

async function loadCloudTrip(id) {
  state.cloudStatus = "正在加载云端任务";
  state.cloudStatusTripId = "";
  render();
  try {
    const data = await apiTrip("GET", { id });
    const trip = normalizeTrip(data.trip);
    trip.cloudId = data.id;
    state.trips = [trip];
    state.selectedId = trip.id;
    setCloudStatus(trip, "此出差事项已连接云端");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
    render();
  } catch (error) {
    state.cloudStatus = "";
    state.cloudStatusTripId = "";
    showToast(error.message || "云端任务加载失败");
  }
}

function queueCloudSave(tripId = state.selectedId) {
  const trip = state.trips.find((item) => item.id === tripId);
  if (!trip?.cloudId) return;
  window.clearTimeout(queueCloudSave.timer);
  queueCloudSave.timer = window.setTimeout(async () => {
    const trip = state.trips.find((item) => item.id === tripId);
    if (!trip?.cloudId) return;
    setCloudStatus(trip, "正在保存当前出差事项");
    render();
    try {
      const data = await apiTrip("POST", {
        id: trip.cloudId,
        trip,
      });
      trip.cloudId = data.id;
      setCloudStatus(trip, "当前出差事项已保存");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
      render();
    } catch (error) {
      setCloudStatus(trip, "云端保存失败");
      render();
    }
  }, 500);
}

async function shareCurrentTrip() {
  const trip = getSelectedTrip();
  if (!trip) return;
  setCloudStatus(trip, "正在生成此出差事项的分享链接");
  render();
  try {
    const data = await apiTrip("POST", {
      id: trip.cloudId,
      trip,
    });
    trip.cloudId = data.id;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.trips));
    const shareLink = tripLink(data.id);
    await copyText(shareLink);
    setCloudStatus(trip, "此出差事项分享链接已复制");
    showToast("当前出差事项分享链接已复制");
  } catch (error) {
    state.cloudStatus = "";
    state.cloudStatusTripId = "";
    showToast(error.message || "生成分享链接失败");
  }
  render();
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
}

function updateTrip(mutator) {
  const trip = getSelectedTrip();
  if (!trip) return;
  mutator(trip);
  trip.updatedAt = new Date().toISOString();
  saveTrips();
  render();
}

function createTrip() {
  state.cloudStatus = "";
  state.cloudStatusTripId = "";
  if (window.location.search.includes("trip=")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  const trip = createEmptyTrip();
  state.trips.unshift(trip);
  state.selectedId = trip.id;
  saveTrips();
  render();
}

function deleteTrip(id) {
  if (state.trips.length <= 1) {
    showToast("至少保留一条出差记录");
    return;
  }
  if (!window.confirm("确定删除这条出差记录吗？")) return;
  state.trips = state.trips.filter((trip) => trip.id !== id);
  state.selectedId = state.trips[0]?.id || "";
  state.cloudStatus = "";
  state.cloudStatusTripId = "";
  saveTrips();
  render();
}

function addExpense() {
  updateTrip((trip) => {
    const people = actualPeople(trip);
    trip.expenses.push({
      id: uid(),
      date: tripActualStart(trip) || "",
      type: "meal",
      amount: 0,
      payer: people[0] || "",
      participants: people,
      note: "",
    });
  });
}

function updateExpense(id, key, value) {
  updateTrip((trip) => {
    const expense = trip.expenses.find((item) => item.id === id);
    if (!expense) return;
    expense[key] = value;
  });
}

function removeExpense(id) {
  updateTrip((trip) => {
    trip.expenses = trip.expenses.filter((item) => item.id !== id);
  });
}

function addMemberReport() {
  const name = window.prompt("请输入实际出差人员姓名");
  if (!name?.trim()) return;
  updateTrip((trip) => {
    const cleanName = name.trim();
    if (reportPeople(trip).includes(cleanName)) {
      showToast("这个人员已经在任务中");
      return;
    }
    trip.memberReports.push({
      id: uid(),
      name: cleanName,
      destination: "",
      startDate: "",
      endDate: "",
      status: "pending",
      transportMode: "none",
      ticketAmount: 0,
      ticketBuyer: "",
      drives: false,
      vehicleType: "none",
      note: "",
    });
  });
}

function updateMemberReport(id, key, value) {
  updateTrip((trip) => {
    const report = trip.memberReports.find((item) => item.id === id);
    if (!report) return;
    const oldName = report.name;
    if (key === "status") {
      report.status = value;
      if (value === "absent") {
        report.destination = "";
        report.startDate = "";
        report.endDate = "";
        report.drives = false;
        report.vehicleType = "none";
        report.transportMode = "none";
        report.ticketAmount = 0;
        report.ticketBuyer = "";
        trip.expenses.forEach((expense) => {
          expense.participants = (expense.participants || []).filter(
            (name) => name !== report.name,
          );
          if (expense.payer === report.name) expense.payer = "";
        });
      }
      if (value === "traveled" && report.vehicleType === "none" && report.drives) {
        report.vehicleType = "ev";
      }
      if (value === "traveled") {
        report.startDate ||= trip.plan.startDate || "";
        report.endDate ||= trip.plan.endDate || "";
        if (!report.transportMode) report.transportMode = "none";
      }
      return;
    }
    if (key === "transportMode") {
      report.transportMode = value;
      if (!transportModes[report.transportMode]) report.transportMode = "none";
      if (report.transportMode === "selfDrive") {
        report.drives = true;
        report.vehicleType = report.vehicleType === "none" ? "ev" : report.vehicleType;
        report.ticketAmount = 0;
        report.ticketBuyer = "";
        report.status = "traveled";
        report.startDate ||= trip.plan.startDate || "";
        report.endDate ||= trip.plan.endDate || "";
      }
      if (report.transportMode === "train" || report.transportMode === "flight") {
        report.drives = false;
        report.vehicleType = "none";
        report.status = "traveled";
        report.startDate ||= trip.plan.startDate || "";
        report.endDate ||= trip.plan.endDate || "";
      }
      if (report.transportMode === "none") {
        report.drives = false;
        report.vehicleType = "none";
        report.ticketAmount = 0;
        report.ticketBuyer = "";
      }
      return;
    }
    if (key === "drives") {
      report.drives = value === true || value === "true";
      report.vehicleType = report.drives ? report.vehicleType || "ev" : "none";
      if (report.vehicleType === "none" && report.drives) report.vehicleType = "ev";
      report.transportMode = report.drives ? "selfDrive" : "none";
      if (report.drives) {
        report.status = "traveled";
        report.startDate ||= trip.plan.startDate || "";
        report.endDate ||= trip.plan.endDate || "";
        report.ticketAmount = 0;
        report.ticketBuyer = "";
      }
      return;
    }
    report[key] = key === "ticketAmount" ? Number(value || 0) : value;
    if (key === "vehicleType") {
      report.drives = value !== "none";
      report.transportMode = report.drives ? "selfDrive" : "none";
      if (report.drives) {
        report.status = "traveled";
        report.startDate ||= trip.plan.startDate || "";
        report.endDate ||= trip.plan.endDate || "";
      }
    }
    if ((key === "ticketAmount" || key === "ticketBuyer") && value) {
      report.status = "traveled";
      report.startDate ||= trip.plan.startDate || "";
      report.endDate ||= trip.plan.endDate || "";
    }
    if ((key === "startDate" || key === "endDate" || key === "destination") && value) {
      report.status = "traveled";
    }
    if (key === "name" && oldName !== value) {
      trip.expenses.forEach((expense) => {
        if (expense.payer === oldName) expense.payer = value;
        expense.participants = (expense.participants || []).map((name) =>
          name === oldName ? value : name,
        );
      });
    }
  });
}

function removeMemberReport(id) {
  updateTrip((trip) => {
    const report = trip.memberReports.find((item) => item.id === id);
    if (!report) return;
    if (planPeople(trip).includes(report.name)) {
      report.startDate = "";
      report.endDate = "";
      report.destination = "";
      report.status = "pending";
      report.transportMode = "none";
      report.ticketAmount = 0;
      report.ticketBuyer = "";
      report.drives = false;
      report.vehicleType = "none";
      report.note = "";
      return;
    }
    trip.memberReports = trip.memberReports.filter((item) => item.id !== id);
    trip.expenses.forEach((expense) => {
      expense.participants = (expense.participants || []).filter(
        (name) => name !== report.name,
      );
      if (expense.payer === report.name) expense.payer = "";
    });
  });
}

function toggleParticipant(expenseId, person) {
  updateTrip((trip) => {
    const expense = trip.expenses.find((item) => item.id === expenseId);
    if (!expense) return;
    const set = new Set(expense.participants || []);
    if (set.has(person)) set.delete(person);
    else set.add(person);
    expense.participants = [...set];
  });
}

function resetSample() {
  if (!window.confirm("这会用示例数据覆盖当前浏览器中的数据，确定继续吗？")) return;
  state.cloudStatus = "";
  state.cloudStatusTripId = "";
  if (window.location.search.includes("trip=")) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  state.trips = sampleTrips();
  state.selectedId = state.trips[0].id;
  saveTrips();
  render();
}

function xmlCell(value, type = "String") {
  const actualType = type === "Number" ? "Number" : "String";
  return `<Cell><Data ss:Type="${actualType}">${escapeHtml(value)}</Data></Cell>`;
}

function xmlRow(values) {
  return `<Row>${values
    .map((item) => xmlCell(item.value, item.type))
    .join("")}</Row>`;
}

function worksheet(name, rows) {
  return `<Worksheet ss:Name="${escapeHtml(name)}"><Table>${rows.join("")}</Table></Worksheet>`;
}

function buildExportFile(trip) {
  const summary = totals(trip);
  const settlement = calculateSettlement(trip);
  const completion = completionStats(trip);
  const dateOverview = tripDateOverview(trip);
  const overviewRows = [
    xmlRow([{ value: "字段" }, { value: "内容" }]),
    xmlRow([{ value: "出差名称" }, { value: trip.title }]),
    xmlRow([{ value: "负责人" }, { value: trip.plan.owner }]),
    xmlRow([{ value: "计划目的地" }, { value: trip.plan.destination }]),
    xmlRow([{ value: "实际目的地" }, { value: actualDestination(trip) }]),
    xmlRow([{ value: "计划日期" }, { value: dateRange(trip.plan.startDate, trip.plan.endDate) }]),
    xmlRow([{ value: "实际日期" }, { value: dateRange(tripActualStart(trip), tripActualEnd(trip)) }]),
    xmlRow([{ value: "填报进度" }, { value: `${completion.completed}/${completion.planned || 0}` }]),
    xmlRow([{ value: "全员已填报" }, { value: completion.allDone ? "是" : "否" }]),
    xmlRow([{ value: "计划人天" }, { value: dateOverview.planPersonDays, type: "Number" }]),
    xmlRow([{ value: "合计人天" }, { value: summary.days, type: "Number" }]),
    xmlRow([{ value: "计划人员" }, { value: planPeople(trip).join("、") }]),
    xmlRow([{ value: "实际人员" }, { value: actualPeople(trip).join("、") }]),
    xmlRow([{ value: "补贴标准" }, { value: `${DAILY_ALLOWANCE} 元/人/天` }]),
    xmlRow([{ value: "共同费用总额" }, { value: summary.expenseTotal, type: "Number" }]),
    xmlRow([{ value: "车辆补贴总额" }, { value: summary.vehicleTotal, type: "Number" }]),
    xmlRow([{ value: "交通票据报销总额" }, { value: summary.ticketTotal, type: "Number" }]),
    xmlRow([{ value: "最终应发/应收总额" }, { value: summary.finalTotal, type: "Number" }]),
  ];

  const expenseRows = [
    xmlRow([
      { value: "日期" },
      { value: "类型" },
      { value: "说明" },
      { value: "金额" },
      { value: "垫付人/应收人" },
      { value: "参与平摊人员" },
      { value: "人均扣除" },
    ]),
    ...trip.expenses.map((expense) => {
      const participants = unique(expense.participants || []);
      return xmlRow([
        { value: expense.date },
        { value: expenseLabel(expense.type) },
        { value: expense.note },
        { value: Number(expense.amount || 0), type: "Number" },
        { value: expense.payer },
        { value: participants.join("、") },
        {
          value: participants.length
            ? Number(expense.amount || 0) / participants.length
            : 0,
          type: "Number",
        },
      ]);
    }),
  ];

  const settlementRows = [
    xmlRow([
      { value: "人员" },
      { value: "实际天数" },
      { value: "基础补贴" },
      { value: "平摊扣除" },
      { value: "共同费用垫付应收" },
      { value: "车辆补贴应收" },
      { value: "交通方式" },
      { value: "交通票据报销" },
      { value: "购票人" },
      { value: "最终金额" },
    ]),
    ...settlement.map((row) =>
      xmlRow([
        { value: row.name },
        { value: row.days, type: "Number" },
        { value: row.base, type: "Number" },
        { value: row.sharedDeduction, type: "Number" },
        { value: row.advanceReceivable, type: "Number" },
        { value: row.vehicleReceivable, type: "Number" },
        { value: transportLabel(row.transportMode) },
        { value: row.ticketAmount, type: "Number" },
        { value: row.ticketBuyer },
        { value: row.finalAmount, type: "Number" },
      ]),
    ),
  ];

  const reportRows = [
    xmlRow([
      { value: "人员" },
      { value: "计划内/临时" },
      { value: "填报状态" },
      { value: "计划日期" },
      { value: "实际目的地" },
      { value: "实际出发日期" },
      { value: "实际返回日期" },
      { value: "自然日天数" },
      { value: "交通方式" },
      { value: "交通票据费用" },
      { value: "购票人" },
      { value: "是否开车" },
      { value: "车辆类型" },
      { value: "车辆补贴" },
      { value: "成员说明" },
    ]),
    ...memberDateRows(trip).map((row) => {
      const report = row.report || {};
      return xmlRow([
        { value: row.name },
        { value: row.planned ? "计划内" : "临时加入" },
        { value: row.statusLabel },
        { value: row.planDate },
        { value: report.destination || "" },
        { value: report.startDate || "" },
        { value: report.endDate || "" },
        { value: row.actualDays, type: "Number" },
        { value: transportLabel(report.transportMode) },
        { value: hasTicketTransport(report) ? Number(report.ticketAmount || 0) : 0, type: "Number" },
        { value: hasTicketTransport(report) ? report.ticketBuyer || "" : "" },
        { value: report.drives ? "是" : "否" },
        { value: report.drives ? vehicleTypes[report.vehicleType]?.label || "" : "" },
        {
          value: report.drives
            ? vehicleTypes[report.vehicleType]?.allowance || 0
            : 0,
          type: "Number",
        },
        { value: report.note || "" },
      ]);
    }),
  ];

  const diffSheetRows = [
    xmlRow([{ value: "对比项" }, { value: "计划" }, { value: "实际" }, { value: "偏差" }]),
    ...diffRows(trip).map((row) =>
      xmlRow([
        { value: row.item },
        { value: row.plan },
        { value: row.actual },
        { value: row.diff },
      ]),
    ),
  ];

  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
${worksheet("出差概览", overviewRows)}
${worksheet("成员填报明细", reportRows)}
${worksheet("共同费用明细", expenseRows)}
${worksheet("个人结算汇总", settlementRows)}
${worksheet("计划与实际偏差", diffSheetRows)}
</Workbook>`;

  const safeTitle = trip.title.replace(/[\\/:*?"<>|]/g, "_") || "出差记录";
  return {
    filename: `出差结算_${safeTitle}_${tripActualStart(trip) || "未填日期"}.xls`,
    xml,
  };
}

function downloadExportFile(file) {
  const blob = new Blob([file.xml], {
    type: "application/vnd.ms-excel;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportTrip(trip) {
  const file = buildExportFile(trip);
  state.exportFile = {
    ...file,
    createdAt: new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };
  downloadExportFile(file);
  showToast("导出文件已生成");
}

async function copyExportFile() {
  if (!state.exportFile) return;
  try {
    await navigator.clipboard.writeText(state.exportFile.xml);
    showToast("已复制导出内容");
  } catch {
    showToast("复制失败，请换用浏览器下载");
  }
}

function retryExportDownload() {
  if (!state.exportFile) return;
  downloadExportFile(state.exportFile);
  showToast("已重新触发下载");
}

function renderShell() {
  const trip = getSelectedTrip();
  const filteredTrips = state.trips.filter((item) => {
    const text = [
      item.title,
      item.plan.destination,
      item.plan.peopleText,
      item.plan.owner,
      actualDestination(item),
      reportPeople(item).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(state.query.toLowerCase());
  });

  return `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M5.2 11.2 6.6 7.4A2.2 2.2 0 0 1 8.7 6h6.6a2.2 2.2 0 0 1 2.1 1.4l1.4 3.8" />
              <path d="M4 11.2h16a1.8 1.8 0 0 1 1.8 1.8v3.7H2.2V13A1.8 1.8 0 0 1 4 11.2Z" />
              <path d="M6.2 16.7v1.2M17.8 16.7v1.2M7.2 13.8h.1M16.7 13.8h.1" />
              <path d="M9 9h6" />
            </svg>
          </div>
          <div>
            <h1>出差记录与补贴结算</h1>
            <p>计划偏差、共同费用、车辆补贴和个人最终金额</p>
          </div>
        </div>
        <div class="actions">
          <button class="button ghost" data-action="reset-sample" title="恢复示例数据">↻ 示例</button>
          <button class="button" data-action="share-trip" title="生成成员填写链接">⛓ 分享任务</button>
          <button class="button" data-action="export" title="导出当前出差 Excel">⇩ 导出</button>
          <button class="button primary" data-action="new-trip" title="新增出差记录">＋ 新增出差</button>
        </div>
      </header>
      <main class="layout">
        ${renderMobileTripSwitcher(filteredTrips)}
        <aside class="sidebar">
          <div class="toolbar">
            <input class="search" data-action="search" value="${escapeHtml(state.query)}" placeholder="搜索出差、地点、人员" />
          </div>
          <div class="trip-list">
            ${
              filteredTrips.length
                ? filteredTrips.map(renderTripItem).join("")
                : `<div class="empty-state">没有匹配的出差记录</div>`
            }
          </div>
        </aside>
        <section class="main-panel">
          ${renderCloudNotice()}
          ${renderExportNotice()}
          ${trip ? renderTripPanel(trip) : `<div class="empty-state">请新增一条出差记录</div>`}
        </section>
      </main>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    </div>
  `;
}

function renderCloudNotice() {
  const trip = getSelectedTrip();
  const status = getCloudStatus(trip);
  const shareLink = trip?.cloudId ? tripLink(trip.cloudId) : "";
  if (!shareLink && !status) return "";
  return `
    <div class="cloud-notice">
      <div>
        <strong>${escapeHtml(status || "此出差事项已启用共享")}</strong>
        <span>${escapeHtml(shareLink || "负责人可将当前出差事项链接发给成员填写")}</span>
      </div>
      ${
        shareLink
          ? `<button class="button" data-action="copy-share-link">复制链接</button>`
          : ""
      }
    </div>
  `;
}

function renderMobileTripSwitcher(trips) {
  if (!trips.length) return "";
  return `
    <div class="mobile-trip-switcher">
      <label>当前出差任务</label>
      <select data-action="mobile-select">
        ${trips
          .map(
            (trip) =>
              `<option value="${trip.id}" ${trip.id === state.selectedId ? "selected" : ""}>${escapeHtml(trip.title)}</option>`,
          )
          .join("")}
      </select>
    </div>
  `;
}

function renderExportNotice() {
  if (!state.exportFile) return "";
  return `
    <div class="export-notice">
      <div>
        <strong>导出文件已生成</strong>
        <span>${escapeHtml(state.exportFile.filename)} · ${escapeHtml(state.exportFile.createdAt)}</span>
      </div>
      <div class="actions">
        <button class="button" data-action="export-retry">重新下载</button>
        <button class="button ghost" data-action="export-copy">复制内容</button>
        <button class="button icon" data-action="export-close" title="关闭">×</button>
      </div>
    </div>
  `;
}

function renderTripItem(trip) {
  const summary = totals(trip);
  return `
    <button class="trip-item ${trip.id === state.selectedId ? "active" : ""}" data-select="${trip.id}">
      <div class="trip-title">
        <span>${escapeHtml(trip.title)}</span>
        <i class="status-dot"></i>
      </div>
      <div class="trip-meta">
        <span>${escapeHtml(dateRange(tripActualStart(trip), tripActualEnd(trip)))}</span>
        <span>${escapeHtml(actualPeople(trip).join("、") || "未填写实际人员")}</span>
        <span>${summary.people} 人 · ${summary.days} 人天 · ￥${money(summary.finalTotal)}</span>
      </div>
    </button>
  `;
}

function renderTripPanel(trip) {
  const completion = completionStats(trip);
  const followups = pendingPlannedReports(trip).map((report) => report.name);
  const tempIncomplete = incompleteTempReports(trip).map((report) => report.name);
  return `
    <div class="panel">
      <div class="panel-header">
        <div>
          <h2>${escapeHtml(trip.title)}</h2>
          <p>负责人：${escapeHtml(trip.plan.owner || "未填写")}。成员各自填报实际行程，负责人统一维护共同费用并导出结算。</p>
          <div class="status-line">
            <span class="status-pill ${completion.allDone ? "done" : "pending"}">
              ${completion.allDone ? "全员已填报" : `计划内 ${completion.pending} 人待填报`}
            </span>
            <span class="status-pill">已确认 ${completion.completed}/${completion.planned || 0}</span>
            ${
              tempIncomplete.length
                ? `<span class="status-pill pending">临时人员未完整填写 ${tempIncomplete.length} 人</span>`
                : ""
            }
          </div>
        </div>
        <div class="actions">
          <button class="button danger" data-action="delete-trip" title="删除当前记录">删除</button>
        </div>
      </div>
      <nav class="anchor-nav">
        <a href="#plan-section">计划</a>
        <a href="#date-section">日期总览</a>
        <a href="#member-section">成员填报</a>
        <a href="#expense-section">共同费用</a>
        <a href="#summary-section">结算</a>
      </nav>
      <div class="content">
        ${renderFollowupNotice(followups, tempIncomplete)}
        <section class="work-section" id="plan-section">
          <div class="section-title">
            <div>
              <h3>出差计划</h3>
              <div class="hint">负责人建立任务后，把当前出差事项链接发给成员填写。</div>
            </div>
          </div>
          ${renderPlanTab(trip)}
        </section>
        <section class="work-section" id="date-section">
          ${renderDateOverview(trip)}
        </section>
        <section class="work-section" id="member-section">
          ${renderActualTab(trip)}
        </section>
        <section class="work-section" id="expense-section">
          ${renderExpensesTab(trip)}
        </section>
        <section class="work-section" id="summary-section">
          ${renderSummaryTab(trip)}
        </section>
        <section class="work-section" id="diff-section">
          <div class="section-title">
            <div>
              <h3>计划与实际偏差</h3>
              <div class="hint">用于负责人导出前快速复核。</div>
            </div>
          </div>
          ${renderDiffTab(trip)}
        </section>
      </div>
    </div>
  `;
}

function renderPlanTab(trip) {
  return `
    <div class="grid">
      ${inputField("出差名称", "title", trip.title, "text", "trip-title")}
      ${inputField("负责人", "plan.owner", trip.plan.owner, "text", "例如：张三")}
      ${inputField("计划目的地", "plan.destination", trip.plan.destination, "text", "例如：上海、杭州")}
      ${inputField("计划出发日期", "plan.startDate", trip.plan.startDate, "date")}
      ${inputField("计划返回日期", "plan.endDate", trip.plan.endDate, "date")}
      ${textareaField("计划人员", "plan.peopleText", trip.plan.peopleText, "用逗号或换行分隔，例如：张三，李四，王五")}
      ${textareaField("计划说明", "plan.note", trip.plan.note, "行程安排、客户或项目说明")}
    </div>
  `;
}

function renderFollowupNotice(followups, tempIncomplete) {
  if (!followups.length && !tempIncomplete.length) return "";
  return `
    <div class="followup-notice">
      ${
        followups.length
          ? `<div><strong>待跟进计划内人员</strong><span>${escapeHtml(followups.join("、"))}</span></div>`
          : ""
      }
      ${
        tempIncomplete.length
          ? `<div><strong>临时人员未完整填写</strong><span>${escapeHtml(tempIncomplete.join("、"))}</span></div>`
          : ""
      }
    </div>
  `;
}

function renderDateOverview(trip) {
  const overview = tripDateOverview(trip);
  const rows = memberDateRows(trip);
  return `
    <div class="section-title">
      <div>
        <h3>实际出差日期总览</h3>
        <div class="hint">计划、实际和人员填报状态集中核对。</div>
      </div>
    </div>
    <div class="summary-grid date-summary">
      <div class="metric"><span>计划日期</span><strong>${escapeHtml(dateRange(trip.plan.startDate, trip.plan.endDate))}</strong></div>
      <div class="metric"><span>实际日期</span><strong>${escapeHtml(dateRange(overview.actualStart, overview.actualEnd))}</strong></div>
      <div class="metric"><span>日期偏差</span><strong>${escapeHtml(overview.dayDiff)}</strong></div>
      <div class="metric"><span>计划人天</span><strong>${overview.planPersonDays}</strong></div>
      <div class="metric"><span>实际人天</span><strong>${overview.actualPersonDays}</strong></div>
    </div>
    <div class="table-wrap compact-table">
      <table>
        <thead>
          <tr>
            <th>人员</th>
            <th>状态/操作</th>
            <th>计划日期</th>
            <th>实际日期</th>
            <th class="number">实际天数</th>
            <th>偏差</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                      <tr>
                        <td>${escapeHtml(row.name)}</td>
                        <td><span class="status-pill ${row.statusClass}">${escapeHtml(row.statusLabel)}</span></td>
                        <td>${escapeHtml(row.planDate)}</td>
                        <td>${escapeHtml(row.actualDate)}</td>
                        <td class="number">${row.status === "pending" ? "-" : row.actualDays}</td>
                        <td>${escapeHtml(row.diff)}</td>
                      </tr>
                    `,
                  )
                  .join("")
              : `<tr><td colspan="6">请先在计划里填写人员。</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderActualTab(trip) {
  const planned = planPeople(trip);
  const buyerOptions = unique(["公司", ...reportPeople(trip)]);
  return `
    <div class="section-title">
      <div>
        <h3>成员实际填报</h3>
        <div class="hint">用快捷按钮确认是否出差；火车/飞机票据费用只做报销登记，不参与共同分摊。</div>
      </div>
      <button class="button primary" data-action="add-member">＋ 新增实际人员</button>
    </div>
    <datalist id="ticket-buyer-options">
      ${buyerOptions.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}
    </datalist>
    <div class="member-table table-wrap">
      <table>
        <thead>
          <tr>
            <th>人员</th>
            <th>状态</th>
            <th>实际目的地</th>
            <th>实际出发</th>
            <th>实际返回</th>
            <th>交通方式</th>
            <th class="number">票据费用</th>
            <th>购票人</th>
            <th>车辆类型</th>
            <th>备注</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${
            trip.memberReports.length
              ? trip.memberReports.map((report) => renderMemberTableRow(report, planned)).join("")
              : `<tr><td colspan="11">请先在计划里填写计划人员，或新增实际人员。</td></tr>`
          }
        </tbody>
      </table>
    </div>
    <div class="member-grid mobile-member-grid">
      ${
        trip.memberReports.length
          ? trip.memberReports.map((report) => renderMemberCard(report, planned)).join("")
          : `<div class="empty-state">请先在计划里填写计划人员，或新增实际人员。</div>`
      }
    </div>
  `;
}

function renderMemberStatusButtons(report) {
  const status = reportStatus(report);
  const markedTraveled = report.status === "traveled" || status === "traveled" || status === "partial";
  return `
    <div class="quick-status" aria-label="填报状态">
      <button class="button ${markedTraveled ? "primary" : "ghost"}" data-member-status="${report.id}" data-status="traveled" type="button">已出差</button>
      <button class="button ${status === "absent" ? "danger-soft" : "ghost"}" data-member-status="${report.id}" data-status="absent" type="button">未出差</button>
    </div>
  `;
}

function renderTransportSelect(report, disabled) {
  return `
    <select data-member="${report.id}" data-member-key="transportMode" ${disabled ? "disabled" : ""}>
      <option value="none" ${report.transportMode === "none" ? "selected" : ""}>请选择</option>
      <option value="selfDrive" ${report.transportMode === "selfDrive" ? "selected" : ""}>自驾</option>
      <option value="train" ${report.transportMode === "train" ? "selected" : ""}>火车</option>
      <option value="flight" ${report.transportMode === "flight" ? "selected" : ""}>飞机</option>
    </select>
  `;
}

function renderMemberTableRow(report, planned) {
  const isPlanned = planned.includes(report.name);
  const absent = reportStatus(report) === "absent";
  const ticketTransport = hasTicketTransport(report);
  const selfDrive = report.transportMode === "selfDrive";
  return `
    <tr>
      <td>
        <input class="table-input name-input" data-member="${report.id}" data-member-key="name" value="${escapeHtml(report.name)}" ${isPlanned ? "disabled" : ""} />
        <span class="row-hint">${isPlanned ? "计划内" : "临时加入"}</span>
      </td>
      <td>
        <div class="status-control">
          ${renderMemberStatusButtons(report)}
        </div>
      </td>
      <td><input class="table-input" data-member="${report.id}" data-member-key="destination" value="${escapeHtml(report.destination)}" ${absent ? "disabled" : ""} /></td>
      <td><input class="table-input date-input" type="date" data-member="${report.id}" data-member-key="startDate" value="${escapeHtml(report.startDate)}" ${absent ? "disabled" : ""} /></td>
      <td><input class="table-input date-input" type="date" data-member="${report.id}" data-member-key="endDate" value="${escapeHtml(report.endDate)}" ${absent ? "disabled" : ""} /></td>
      <td>
        ${renderTransportSelect(report, absent)}
      </td>
      <td>
        <input class="table-input money-input" type="number" min="0" step="0.01" data-member="${report.id}" data-member-key="ticketAmount" value="${escapeHtml(report.ticketAmount || "")}" ${ticketTransport && !absent ? "" : "disabled"} />
      </td>
      <td>
        <input class="table-input buyer-input" list="ticket-buyer-options" data-member="${report.id}" data-member-key="ticketBuyer" value="${escapeHtml(report.ticketBuyer || "")}" ${ticketTransport && !absent ? "" : "disabled"} />
      </td>
      <td>
        <select data-member="${report.id}" data-member-key="vehicleType" ${selfDrive && !absent ? "" : "disabled"}>
          <option value="ev" ${report.vehicleType === "ev" ? "selected" : ""}>新能源</option>
          <option value="fuel" ${report.vehicleType === "fuel" ? "selected" : ""}>油车</option>
        </select>
      </td>
      <td><input class="table-input note-input" data-member="${report.id}" data-member-key="note" value="${escapeHtml(report.note)}" /></td>
      <td>
        <div class="row-actions">
          <button class="button icon danger" data-remove-member="${report.id}" title="${isPlanned ? "清空填报" : "移除人员"}">×</button>
        </div>
      </td>
    </tr>
  `;
}

function renderMemberCard(report, planned) {
  const days = naturalDays(report.startDate, report.endDate);
  const status = reportStatus(report);
  const absent = status === "absent";
  const ticketTransport = hasTicketTransport(report);
  const selfDrive = report.transportMode === "selfDrive";
  const statusText = status === "traveled" && report.startDate && report.endDate ? `${days} 天` : reportStatusLabel(report);
  return `
    <div class="member-card">
      <div class="expense-head">
        <strong>${escapeHtml(report.name || "未命名成员")}</strong>
        <div class="actions">
          <span class="chip">${planned.includes(report.name) ? "计划内" : "临时加入"} · ${statusText}</span>
          <button class="button icon danger" data-remove-member="${report.id}" title="${planned.includes(report.name) ? "清空填报" : "移除人员"}">×</button>
        </div>
      </div>
      <div class="grid">
        <div class="field">
          <label>姓名</label>
          <input data-member="${report.id}" data-member-key="name" value="${escapeHtml(report.name)}" ${planned.includes(report.name) ? "disabled" : ""} />
        </div>
        <div class="field">
          <label>填报状态</label>
          ${renderMemberStatusButtons(report)}
        </div>
        <div class="field">
          <label>实际目的地</label>
          <input data-member="${report.id}" data-member-key="destination" value="${escapeHtml(report.destination)}" placeholder="例如：上海、苏州" ${absent ? "disabled" : ""} />
        </div>
        <div class="field">
          <label>实际出发日期</label>
          <input type="date" data-member="${report.id}" data-member-key="startDate" value="${escapeHtml(report.startDate)}" ${absent ? "disabled" : ""} />
        </div>
        <div class="field">
          <label>实际返回日期</label>
          <input type="date" data-member="${report.id}" data-member-key="endDate" value="${escapeHtml(report.endDate)}" ${absent ? "disabled" : ""} />
        </div>
        <div class="field">
          <label>交通方式</label>
          ${renderTransportSelect(report, absent)}
        </div>
        <div class="field">
          <label>票据费用</label>
          <input type="number" min="0" step="0.01" data-member="${report.id}" data-member-key="ticketAmount" value="${escapeHtml(report.ticketAmount || "")}" placeholder="火车/飞机票金额" ${ticketTransport && !absent ? "" : "disabled"} />
        </div>
        <div class="field">
          <label>购票人</label>
          <input list="ticket-buyer-options" data-member="${report.id}" data-member-key="ticketBuyer" value="${escapeHtml(report.ticketBuyer || "")}" placeholder="个人、公司或同事" ${ticketTransport && !absent ? "" : "disabled"} />
        </div>
        <div class="field">
          <label>车辆类型</label>
          <select data-member="${report.id}" data-member-key="vehicleType" ${selfDrive && !absent ? "" : "disabled"}>
            <option value="ev" ${report.vehicleType === "ev" ? "selected" : ""}>新能源车（补贴 150）</option>
            <option value="fuel" ${report.vehicleType === "fuel" ? "selected" : ""}>油车（补贴 250）</option>
          </select>
        </div>
        <div class="field full">
          <label>成员说明</label>
          <input data-member="${report.id}" data-member-key="note" value="${escapeHtml(report.note)}" placeholder="实际行程变化或补充说明" />
        </div>
      </div>
    </div>
  `;
}

function renderExpensesTab(trip) {
  const people = actualPeople(trip);
  return `
    <div class="section-title">
      <div>
        <h3>共同费用</h3>
        <div class="hint">只记录需要从补贴中平摊扣除的共同餐饮和共同交通；车辆补贴在成员填报里设置。</div>
      </div>
      <button class="button primary" data-action="add-expense">＋ 添加费用</button>
    </div>
    ${
      people.length
        ? ""
        : `<div class="empty-state">请先在“成员填报”里填写实际人员和日期，再添加共同费用。</div>`
    }
    ${
      trip.expenses.length
        ? trip.expenses.map((expense) => renderExpenseCard(expense, people)).join("")
        : `<div class="empty-state">还没有共同费用</div>`
    }
  `;
}

function renderExpenseCard(expense, people) {
  const participants = unique(expense.participants || []);
  const perPerson = participants.length
    ? Number(expense.amount || 0) / participants.length
    : 0;
  return `
    <div class="expense-card">
      <div class="expense-head">
        <strong>${escapeHtml(expenseLabel(expense.type))} · ￥${money(expense.amount)}</strong>
        <button class="button icon danger" data-remove-expense="${expense.id}" title="删除费用">×</button>
      </div>
      <div class="grid three">
        <div class="field">
          <label>日期</label>
          <input type="date" data-expense="${expense.id}" data-expense-key="date" value="${escapeHtml(expense.date)}" />
        </div>
        <div class="field">
          <label>类型</label>
          <select data-expense="${expense.id}" data-expense-key="type">
            ${expenseTypes
              .map(
                (type) =>
                  `<option value="${type.value}" ${expense.type === type.value ? "selected" : ""}>${type.label}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="field">
          <label>金额</label>
          <input type="number" min="0" step="0.01" data-expense="${expense.id}" data-expense-key="amount" value="${escapeHtml(expense.amount)}" />
        </div>
        <div class="field">
          <label>垫付人/应收人</label>
          <select data-expense="${expense.id}" data-expense-key="payer">
            <option value="">请选择</option>
            ${people
              .map(
                (person) =>
                  `<option value="${escapeHtml(person)}" ${expense.payer === person ? "selected" : ""}>${escapeHtml(person)}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="field full">
          <label>备注</label>
          <input data-expense="${expense.id}" data-expense-key="note" value="${escapeHtml(expense.note)}" placeholder="例如：客户晚餐、机场打车" />
        </div>
      </div>
      <div class="field">
        <label>参与平摊人员</label>
        <div class="check-group">
          ${people
            .map(
              (person) => `
                <label class="chip">
                  <input type="checkbox" data-participant="${expense.id}" value="${escapeHtml(person)}" ${participants.includes(person) ? "checked" : ""} />
                  ${escapeHtml(person)}
                </label>
              `,
            )
            .join("")}
        </div>
        <div class="hint">当前 ${participants.length} 人平摊，人均扣除 ￥${money(perPerson)}</div>
      </div>
    </div>
  `;
}

function renderSummaryTab(trip) {
  const summary = totals(trip);
  const rows = calculateSettlement(trip);
  return `
    <div class="summary-grid">
      <div class="metric"><span>实际人数</span><strong>${summary.people}</strong></div>
      <div class="metric"><span>合计人天</span><strong>${summary.days}</strong></div>
      <div class="metric"><span>共同费用</span><strong>￥${money(summary.expenseTotal)}</strong></div>
      <div class="metric"><span>车辆补贴</span><strong>￥${money(summary.vehicleTotal)}</strong></div>
      <div class="metric"><span>交通票据报销</span><strong>￥${money(summary.ticketTotal)}</strong></div>
      <div class="metric"><span>最终应发/应收</span><strong>￥${money(summary.finalTotal)}</strong></div>
    </div>
    <div class="hint summary-note">交通票据报销仅供后续票据报销核对，不参与共同费用分摊和最终补贴金额。</div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>人员</th>
            <th>实际目的地</th>
            <th class="number">实际天数</th>
            <th class="number">基础补贴</th>
            <th class="number">平摊扣除</th>
            <th class="number">共同费用垫付</th>
            <th class="number">车辆补贴应收</th>
            <th>交通方式</th>
            <th class="number">票据报销</th>
            <th>购票人</th>
            <th class="number">最终金额</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map(
                    (row) => `
                    <tr>
                      <td>${escapeHtml(row.name)}</td>
                      <td>${escapeHtml(row.destination || "未填写")}</td>
                      <td class="number">${row.days}</td>
                      <td class="number">￥${money(row.base)}</td>
                      <td class="number">￥${money(row.sharedDeduction)}</td>
                      <td class="number">￥${money(row.advanceReceivable)}</td>
                      <td class="number">￥${money(row.vehicleReceivable)}</td>
                      <td>${escapeHtml(transportLabel(row.transportMode))}</td>
                      <td class="number">￥${money(row.ticketAmount)}</td>
                      <td>${escapeHtml(row.ticketBuyer || "-")}</td>
                      <td class="number ${row.finalAmount < 0 ? "negative" : "positive"}">￥${money(row.finalAmount)}</td>
                    </tr>
                  `,
                  )
                  .join("")
              : `<tr><td colspan="11">请先在“成员填报”里填写实际人员和实际日期</td></tr>`
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderDiffTab(trip) {
  return `
    <div class="diff-list">
      ${diffRows(trip)
        .map(
          (row) => `
          <div class="diff-row">
            <strong>${escapeHtml(row.item)}</strong>
            <div><span class="hint">计划</span><br />${escapeHtml(row.plan)}</div>
            <div><span class="hint">实际</span><br />${escapeHtml(row.actual)}</div>
            <div><span class="hint">偏差</span><br />${escapeHtml(row.diff)}</div>
          </div>
        `,
        )
        .join("")}
    </div>
  `;
}

function inputField(label, path, value, type = "text", placeholder = "") {
  return `
    <div class="field">
      <label>${label}</label>
      <input type="${type}" data-field="${path}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />
    </div>
  `;
}

function textareaField(label, path, value, placeholder = "") {
  return `
    <div class="field full">
      <label>${label}</label>
      <textarea data-field="${path}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
    </div>
  `;
}

function setByPath(trip, path, value) {
  if (path === "title") {
    trip.title = value || "未命名出差";
    return;
  }
  const [group, key] = path.split(".");
  trip[group][key] = value;
  if (path === "plan.peopleText") syncPlannedReports(trip);
}

function bindEvents() {
  const app = document.querySelector("#app");
  app.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const trip = getSelectedTrip();
    if (target.dataset.action === "new-trip") createTrip();
    if (target.dataset.action === "reset-sample") resetSample();
    if (target.dataset.action === "share-trip") shareCurrentTrip();
    if (target.dataset.action === "copy-share-link" && trip?.cloudId) {
      const shareLink = trip?.cloudId ? tripLink(trip.cloudId) : "";
      copyText(shareLink);
      showToast("当前出差事项分享链接已复制");
    }
    if (target.dataset.action === "export" && trip) exportTrip(trip);
    if (target.dataset.action === "export-retry") retryExportDownload();
    if (target.dataset.action === "export-copy") copyExportFile();
    if (target.dataset.action === "export-close") {
      state.exportFile = null;
      render();
    }
    if (target.dataset.action === "delete-trip" && trip) deleteTrip(trip.id);
    if (target.dataset.action === "add-expense") addExpense();
    if (target.dataset.action === "add-member") addMemberReport();
    if (target.dataset.memberStatus) {
      updateMemberReport(target.dataset.memberStatus, "status", target.dataset.status);
    }
    if (target.dataset.select) {
      state.selectedId = target.dataset.select;
      state.cloudStatus = "";
      state.cloudStatusTripId = "";
      render();
    }
    if (target.dataset.removeExpense) removeExpense(target.dataset.removeExpense);
    if (target.dataset.removeMember) removeMemberReport(target.dataset.removeMember);
  });

  app.addEventListener("input", (event) => {
    const target = event.target;
    if (target.dataset.action === "search") {
      state.query = target.value;
      render();
    }
  });

  app.addEventListener("change", (event) => {
    const target = event.target;
    if (target.dataset.action === "mobile-select") {
      state.selectedId = target.value;
      state.cloudStatus = "";
      state.cloudStatusTripId = "";
      render();
      return;
    }
    if (target.dataset.field) {
      updateTrip((trip) => setByPath(trip, target.dataset.field, target.value));
      return;
    }
    if (target.dataset.participant) {
      toggleParticipant(target.dataset.participant, target.value);
    }
    if (target.dataset.expense) {
      const value =
        target.dataset.expenseKey === "amount" ? Number(target.value) : target.value;
      updateExpense(target.dataset.expense, target.dataset.expenseKey, value);
    }
    if (target.dataset.member) {
      updateMemberReport(target.dataset.member, target.dataset.memberKey, target.value);
    }
  });
}

function render() {
  document.querySelector("#app").innerHTML = renderShell();
}

state.trips = loadTrips();
state.selectedId = state.trips[0]?.id || "";
render();
bindEvents();

const initialTripId = new URLSearchParams(window.location.search).get("trip");
if (initialTripId) loadCloudTrip(initialTripId);
