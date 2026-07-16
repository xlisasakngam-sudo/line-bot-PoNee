const express = require('express');
const Redis = require('ioredis');
const fetch = require('node-fetch');

const redis = new Redis(process.env.REDIS_URL);
const app = express();
app.use(express.json());

// ==================== ENV ====================
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// ==================== CONSTANTS ====================
const REGISTER_URL = 'https://shorturl.asia/Uz5mH';
const FREE_CREDIT_LINE = 'ติดต่อโปรโมชั่นได้เลยนะคะ 💕\nhttps://line.me/R/ti/p/@454npgay';
const RESET_GROUP_1 = '-1003957391663'; // กลุ่มแจ้งปัญหา/รีรหัส
const RESET_GROUP_2 = '-1003957391663'; // กลุ่มแจ้งปัญหา/รีรหัส (เหมือนกัน)
const THIRTY_MIN = 30 * 60;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

// ==================== WITHDRAW SCHEDULE ====================
const DAILY_WITHDRAW_CLOSE_START = '23:30';
const DAILY_WITHDRAW_CLOSE_END   = '00:30';

function isWithdrawClosed() {
  var now = new Date();
  var thaiTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  var hhmm = thaiTime.toISOString().substring(11, 16);
  var dateStr = thaiTime.toISOString().substring(0, 10);
  var closed = (hhmm >= '23:30') || (hhmm < '00:30');
  if (closed) {
    return { closed: true, reason: 'ธนาคารอัปเดตระบบ', until: dateStr + ' 00:30' };
  }
  return { closed: false };
}

function formatWithdrawClosedMsg(until, msgText) {
  var timePart = until.split(' ')[1].replace(':', '.') + ' น.';
  var m = (msgText || '').toLowerCase();

  if (m.includes('จะได้') || m.includes('ได้เลย') || m.includes('ตอน') || m.includes('กี่โมง') || m.includes('เมื่อไ')) {
    return 'ได้เลยค่ะ ตอน ' + timePart + ' เปิดปกติเลยนะคะ 😊\n' +
      'เงินไม่หายไปไหนแน่นอนค่ะ รอแป๊บนึงนะคะ 🙏';
  }
  if (m.includes('นานมาก') || m.includes('นานแค่') || m.includes('นานไหม') || m.includes('รออีก')) {
    return 'ขอโทษนะคะ รอถึง ' + timePart + ' ก็ได้เลยค่ะ\n' +
      'ธนาคารปรับปรุงระบบอยู่ค่ะ เงินปลอดภัยแน่นอนนะคะ 💰';
  }
  if (m.includes('ยังไม่เข้า') || m.includes('ไม่เข้า') || m.includes('ไม่ได้') || m.includes('เช็ค') || m.includes('ตาม')) {
    return 'ขอโทษด้วยนะคะ ตอนนี้ธนาคารปิดปรับปรุงระบบค่ะ\n' +
      'ยอดถอนจะเข้าหลัง ' + timePart + ' นะคะ\n' +
      'เงินไม่หายไปไหนเลยค่ะ มั่นใจได้เลย 💰🙏';
  }
  if (m.includes('กดถอน') || m.includes('ถอนได้ไหม') || m.includes('จะถอน') || m.includes('อยากถอน')) {
    return 'ตอนนี้ระบบถอนปิดชั่วคราวนะคะ ธนาคารปรับปรุงระบบอยู่ค่ะ 🙏\n' +
      'รอถึง ' + timePart + ' ก็ถอนได้เลยค่ะ ฝากได้ตามปกตินะคะ 💰';
  }

  var defaults = [
    'ขอโทษนะคะ ตอนนี้ธนาคารปิดปรับปรุงระบบอยู่ค่ะ\nรอถึง ' + timePart + ' ได้เลยนะคะ เงินปลอดภัย 100% ค่ะ 💰🙏',
    'ตอนนี้ระบบถอนหยุดชั่วคราวจากธนาคารค่ะ\nหลัง ' + timePart + ' ถอนได้ปกติเลยนะคะ มั่นใจได้เลยค่ะ 🙏',
    'ธนาคารปรับปรุงระบบอยู่ค่ะ เปิดอีกทีตอน ' + timePart + ' นะคะ\nเงินของลูกค้าปลอดภัยแน่นอนค่ะ 💰',
  ];
  return defaults[Math.floor(Math.random() * defaults.length)];
}

// ==================== KEYWORD LISTS ====================

const DONE_WORDS = [
  'เข้าแล้ว','ได้แล้ว','เรียบร้อย','โอเค','ok','โอเคแล้ว',
  'เข้าล่ะ','เข้าละ','ได้ล่ะ','ได้ละ','โอเคล่ะ','เสร็จแล้ว',
  'ผ่านแล้ว','หายแล้ว','แก้ได้แล้ว','จำได้แล้ว','เข้าได้แล้ว',
  'ไม่ต้องแล้ว','ไม่เป็นไร','ยกเลิก','ไม่เอาแล้ว',
  'ให้ไปแล้ว','ให้แล้ว','บอกไปแล้ว','แจ้งไปแล้ว','ส่งไปให้แล้ว',
  'รับทราบ','ทราบแล้ว','ขอบคุณ','ขอบคุณค่ะ','ขอบคุณครับ',
  'ถามีอะไร','ถ้ามีอะไร',
];

const SLIP_SENT_WORDS = [
  'ส่งให้แล้ว','ส่งมาแล้ว','ส่งแล้ว','โอนไปแล้ว','โอนแล้ว',
  'ส่งไปแล้ว','แนบแล้ว','อัปแล้ว','ทำไปแล้ว','ส่งให้ไปแล้ว',
];

function isSlipAlreadySent(text) {
  return SLIP_SENT_WORDS.some(function(w) { return text.includes(w); });
}

function isDone(text) {
  var lower = text.toLowerCase().trim();
  return DONE_WORDS.some(function(w) { return lower.includes(w); });
}

const DEPOSIT_WORDS = [
  'ฝากไม่เข้า','ฝากไม่ได้','เงินไม่เข้า','ยอดไม่เข้า',
  'โอนแล้วไม่เข้า','ฝากแล้วไม่เข้า','เติมไม่เข้า',
  'ยอดยังไม่เข้า','เงินยังไม่เข้า',
  'ฝากเงิน','ฝากเงินไม่เข้า','ฝากเงินไม่ได้','อยากฝาก','ต้องการฝาก',
  'ไม่เข้าล่ะ','ไม่เข้าเลย','ยังไม่เข้า','เข้าไม่ได้','ไม่เข้าครับ','ไม่เข้าค่ะ','ไม่เข้านะ',
];
function isDeposit(text) {
  return DEPOSIT_WORDS.some(function(w) { return text.includes(w); });
}

const WITHDRAW_WORDS = [
  'ถอนไม่เข้า','ถอนไม่ได้','ถอนเงินไม่เข้า','เงินถอนไม่เข้า',
  'ถอนไม่ผ่าน','ถอนช้า','ถอนนาน','ถอนได้ไหม','ถอนเงิน',
  'จะถอน','อยากถอน','ต้องการถอน','ถอนกี่นาที','ถอนกี่โมง',
  'ถอนนานไหม','ถอนนานแค่ไหน','ถอนใช้เวลา','รอถอน',
  'ถอนไปนาน','ถอนไปแล้ว','ถอนไปได้','แจ้งถอน','ยอดถอน',
  'ถอนออก','กดถอน','ทำถอน','ถอนไปไม่เข้า','ถอนไปนานแล้วไม่เข้า',
];
function isWithdraw(text) {
  if (text.includes('ถอนขั้นต่ำ') || text.includes('ขั้นต่ำถอน')) return false;
  return WITHDRAW_WORDS.some(function(w) { return text.includes(w); });
}

const RESET_WORDS = [
  'ลืมรหัสผ่าน','จำรหัสไม่ได้','ลืมพาส','รหัสหาย',
  'login ไม่ได้','ล็อกอินไม่ได้','เข้าไม่ได้','เข้าระบบไม่ได้',
];
function isReset(text) {
  return RESET_WORDS.some(function(w) { return text.includes(w); });
}

const FOLLOWUP_WORDS = [
  'ตามยอด','เช็คยอด','เช็คเงิน','ยอดเข้าไหม','เงินเข้าไหม',
  'ยอดเข้ายัง','เงินเข้ายัง','ตรวจยอด',
];
function isFollowUp(text) {
  return FOLLOWUP_WORDS.some(function(w) { return text.includes(w); });
}

const REGISTER_WORDS = ['สมัคร','ขอลิงก์','ขอเว็บ','ขอแวป','สมัครสมาชิก','ลงทะเบียน'];
function isRegister(text) {
  return REGISTER_WORDS.some(function(w) { return text.includes(w); });
}

const GIVEAWAY_WORDS = ['แจก','เครดิตฟรี','รับฟรี','โปรโมชั่น','โปร','มีแจก','ของแจก','รางวัล'];
function isGiveaway(text) {
  return GIVEAWAY_WORDS.some(function(w) { return text.includes(w); });
}

const POINT_WORDS = ['แต้มสะสม','แลกแต้ม','แต้มแลก','คะแนนสะสม','loyalty'];
function isPoints(text) {
  return POINT_WORDS.some(function(w) { return text.includes(w); });
}

const COUPON_WORDS = ['โค้ด','code','คูปอง','coupon','ใส่โค้ด','กรอกโค้ด'];
function isCoupon(text) {
  return COUPON_WORDS.some(function(w) { return text.toLowerCase().includes(w); });
}

const GROUP_WORDS = [
  'กลุ่ม','telegram','เทเลแกรม','เทเล','เทเร','tg',
  'มีกลุ่ม','กลุ่มไหม','ขอกลุ่ม',
];
function isGroup(text) {
  return GROUP_WORDS.some(function(w) { return text.toLowerCase().includes(w); });
}

const STREAMER_WORDS = [
  'จารโต','jarnto','สตรีมเมอร์','streamer','ไลฟ์','twitch','คลิป','x.com',
];
function isStreamer(text) {
  return STREAMER_WORDS.some(function(w) { return text.toLowerCase().includes(w); });
}

const ANGRY_WORDS = [
  'โกง','ขี้โกง','ควย','สัส','มึง','ห่า','เหี้ย','แม่ง','เชี่ย',
  'กาก','ห่วย','ห่วยแตก','ระบบบ้า','ระบบห่วย','ระบบแตก','โคตร',
];
function isAngry(text) {
  return ANGRY_WORDS.some(function(w) { return text.includes(w); });
}

const CANT_ATTACH_WORDS = [
  'แนบไม่ได้','แนบไม่ขึ้น','อัปโหลดไม่ได้','กดเข้าไปแล้ว',
  'ขึ้นให้เลือกรูป','เลือกไฟล์','เลือกรูป',
];
function isCantAttach(text) {
  return CANT_ATTACH_WORDS.some(function(w) { return text.includes(w); });
}

// ==================== KYC / อนุมัติบัญชี / ยืนยันตัวตน ====================
const KYC_WORDS = [
  'อนุมัติบัญชี','ยืนยันตัวตน','ยืนยันบัญชี','ยืนยันตัว',
  'ยืนยันข้อมูล','อนุมัติ','verify','verification','kyc',
  'บัญชียังไม่','บัญชีไม่ผ่าน','บัญชีไม่อนุมัติ','บัญชีไม่ได้',
  'ผ่านการยืนยัน','ยืนยันก่อน','ต้องยืนยัน',
];
function isKyc(text) {
  return KYC_WORDS.some(function(w) { return text.toLowerCase().includes(w); });
}

function normalizePhone(str) {
  return str.replace(/[-\s()]/g, '');
}
function isPhone(str) {
  var c = normalizePhone(str);
  if (c.startsWith('00')) c = c.substring(1);
  return /^0[5-9]\d{8}$/.test(c);
}
function isPhonePartial(str) {
  var c = normalizePhone(str);
  return /^0[5-9]\d{4,}$/.test(c);
}
function isBankNum(str) {
  return /^\d{9,15}$/.test(str) && !isPhone(str);
}
function extractContact(txt) {
  var phone = null, bank = null, name = null;
  var lower = txt.toLowerCase();

  var bankNames = ['กรุงเทพ','กสิกร','ไทยพาณิชย์','scb','กรุงไทย','ออมสิน','ttb','กรุงศรี','ทหารไทย','bbl','ktb','uob'];
  var cleanTxt = txt;
  for (var bn of bankNames) {
    if (lower.includes(bn)) {
      if (!name) name = bn;
      cleanTxt = cleanTxt.replace(new RegExp(bn, 'gi'), ' ');
    }
  }

  var phonePatterns = cleanTxt.match(/0\d[\d\- ]{4,11}/g) || [];
  for (var p of phonePatterns) {
    var clean = normalizePhone(p);
    if ((isPhone(clean) || isPhonePartial(clean)) && !phone) { phone = clean; break; }
  }
  if (!phone) {
    var allNums = txt.match(/0\d{5,9}/g) || [];
    for (var n of allNums) {
      if ((isPhone(n) || isPhonePartial(n)) && !phone) { phone = n; break; }
    }
  }

  var bankKeywords = ['ttb','scb','กสิกร','กรุงเทพ','ออมสิน','กรุงศรี','กรุงไทย','ทหารไทย','uob','bbl','ktb'];
  for (var bk of bankKeywords) {
    if (lower.includes(bk)) {
      var bankRegex = new RegExp(bk + '[\\s:]*([\\d\\s]{9,15})', 'i');
      var bankMatch = txt.match(bankRegex);
      if (bankMatch) {
        var bankNum = bankMatch[1].replace(/\s/g, '');
        if (isBankNum(bankNum) && !bank) { bank = bankNum; }
      }
    }
  }
  if (!bank) {
    var numbers = cleanTxt.match(/\d+/g) || [];
    for (var num of numbers) {
      if (!phone && (isPhone(num) || isPhonePartial(num))) { phone = num; }
      else if (!bank && isBankNum(num)) { bank = num; }
    }
  }

  var words = txt.split(/\s+|\n/).filter(function(w) {
    var wl = w.toLowerCase();
    return w.length >= 2 && !/^\d+$/.test(w) && !bankKeywords.includes(wl);
  });
  if (words.length > 0 && !name) { name = words.join(' ').substring(0, 50); }

  return { phone, bank, name };
}

function randomPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ==================== LINE API ====================

async function getDisplayName(userId) {
  try {
    var res = await fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { Authorization: 'Bearer ' + LINE_TOKEN },
    });
    var data = await res.json();
    return data.displayName || 'Unknown';
  } catch (e) { return 'Unknown'; }
}

async function lineReply(replyToken, messages) {
  var res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LINE_TOKEN },
    body: JSON.stringify({ replyToken, messages: Array.isArray(messages) ? messages : [messages] }),
  });
  var data = await res.json();
  console.log('REPLY:', JSON.stringify(data).substring(0, 100));
}

function txt(text) { return { type: 'text', text }; }

// ==================== TELEGRAM API ====================

async function tgSend(chatId, text, markup) {
  var body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (markup) body.reply_markup = markup;
  await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function tgMain(text, markup) { await tgSend(TELEGRAM_CHAT_ID, text, markup); }

async function tgAnswer(cbId, text) {
  await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/answerCallbackQuery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: cbId, text }),
  });
}

function stopResumeMarkup(userId) {
  return {
    inline_keyboard: [[
      { text: '\u26D4 หยุดบอท', callback_data: 'stop:' + userId },
      { text: '\u25B6\uFE0F เปิดบอท', callback_data: 'resume:' + userId },
    ]]
  };
}

async function tgNotifyOnce(displayName, msg, ts, userId) {
  var key = 'notified:' + userId;
  if (await redis.get(key)) return;
  await redis.set(key, '1', 'EX', THIRTY_MIN);
  var text = '\u{1F514} ชื่อไลน์: ' + displayName + '\nข้อความ: ' + msg +
    '\nเวลา: ' + new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  await tgMain(text, stopResumeMarkup(userId));
}

async function tgAlert(displayName, msg, ts, userId) {
  var text = '\u{1F6A8} ต้องการแอดมิน!\nชื่อไลน์: ' + displayName +
    '\nเรื่อง: ' + msg +
    '\nเวลา: ' + new Date(ts).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  await tgMain(text, stopResumeMarkup(userId));
  try { await tgSend(RESET_GROUP_2, text); } catch (e) {}
}

async function tgReset(displayName, info) {
  var text = '\u{1F511} <b>ขอรีรหัส</b>\n\u{1F464} ชื่อไลน์: ' + displayName +
    '\n\u{1F4CB} ข้อมูล:\n' + info + '\n\n\u23F0 รีรหัสให้ภายใน 3 นาทีครับ';
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: RESET_GROUP_1, text, parse_mode: 'HTML' }),
    });
  } catch (e) {}
}

async function tgSlipAlert(displayName, info) {
  var text = '\u{1F4B8} <b>ฝากไม่เข้า</b>\n\u{1F464} ชื่อไลน์: ' + displayName +
    '\n\u{1F4CB} ข้อมูล: ' + info + '\n\n\u23F0 ตรวจสอบให้ลูกค้าด้วยครับ';
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: RESET_GROUP_1, text, parse_mode: 'HTML' }),
    });
  } catch (e) {}
}

// ==================== KYC TELEGRAM ALERT ====================

async function tgKycAlert(displayName, info) {
  var text = '\u{1F4CB} <b>ขออนุมัติบัญชี/ยืนยันตัวตน</b>\n' +
    '\u{1F464} ชื่อไลน์: ' + displayName + '\n' +
    '\u{1F4CB} ข้อมูล:\n' + info + '\n\n' +
    '\u23F0 กรุณาดำเนินการให้ลูกค้าด้วยครับ';
  try {
    await fetch('https://api.telegram.org/bot' + TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: RESET_GROUP_1, text, parse_mode: 'HTML' }),
    });
  } catch (e) { console.log('tgKycAlert error:', e.message); }
}

// ==================== REDIS HELPERS ====================

async function isRateLimited(userId) {
  var key = 'rate:' + userId;
  var count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 30);
  return count > 10;
}

async function isRepeatedMsg(userId, msgText) {
  if (!msgText || msgText.length < 2) return false;
  var key = 'lastmsg:' + userId;
  var last = await redis.get(key);
  await redis.set(key, msgText, 'EX', 60);
  return last === msgText;
}

async function isDup(token) {
  var key = 'dup:' + token;
  if (await redis.get(key)) return true;
  await redis.set(key, '1', 'EX', 60);
  return false;
}

async function getLastSeen(userId) {
  var v = await redis.get('seen:' + userId);
  return v ? parseInt(v) : 0;
}
async function setLastSeen(userId) {
  await redis.set('seen:' + userId, Date.now(), 'EX', 86400);
}

async function isStopped(userId) { return !!(await redis.get('stop:' + userId)); }
async function setStop(userId) { await redis.set('stop:' + userId, '1', 'EX', 1200); }
async function clearStop(userId) { await redis.del('stop:' + userId); }

async function getHistory(userId) {
  var v = await redis.get('hist:' + userId);
  return v ? JSON.parse(v) : [];
}
async function addHistory(userId, role, text) {
  var h = await getHistory(userId);
  h.push({ role, content: text });
  if (h.length > 7) h.shift();
  await redis.set('hist:' + userId, JSON.stringify(h), 'EX', 600);
}

async function getSlipState(userId) {
  var v = await redis.get('slip:' + userId);
  return v ? JSON.parse(v) : null;
}
async function setSlipState(userId, state) {
  await redis.set('slip:' + userId, JSON.stringify(state), 'EX', 600);
}
async function clearSlipState(userId) { await redis.del('slip:' + userId); }

async function markSlipSent(userId) { await redis.set('slipsent:' + userId, '1', 'EX', 900); }
async function hasSlipSent(userId) { return !!(await redis.get('slipsent:' + userId)); }
async function clearSlipSent(userId) { await redis.del('slipsent:' + userId); }

async function getResetInfo(userId) {
  var v = await redis.get('reset:' + userId);
  return v ? JSON.parse(v) : null;
}
async function setResetInfo(userId, info) {
  await redis.set('reset:' + userId, JSON.stringify(info), 'EX', 600);
}
async function clearResetInfo(userId) {
  await redis.del('reset:' + userId);
  await redis.del('resetcd:' + userId);
}
async function isResetCD(userId) { return !!(await redis.get('resetcd:' + userId)); }
async function setResetCD(userId) { await redis.set('resetcd:' + userId, '1', 'EX', 180); }
async function isWaitingReset(userId) { return !!(await redis.get('reset:' + userId)); }
async function startWaitingReset(userId) {
  await setResetInfo(userId, { name: null, phone: null, bank: null });
}

async function imgDup(userId) {
  var key = 'imgdup:' + userId;
  if (await redis.get(key)) return true;
  await redis.set(key, '1', 'EX', 10);
  return false;
}

async function markHandled(userId) { await redis.set('handled:' + userId, Date.now(), 'EX', 600); }
async function isHandled(userId) { return !!(await redis.get('handled:' + userId)); }
async function clearHandled(userId) { await redis.del('handled:' + userId); }

async function setCashbackState(userId) { await redis.set('cashback:' + userId, '1', 'EX', 300); }
async function isCashbackState(userId) { return !!(await redis.get('cashback:' + userId)); }
async function clearCashbackState(userId) { await redis.del('cashback:' + userId); }

// ==================== KYC REDIS HELPERS ====================

async function getKycInfo(userId) {
  var v = await redis.get('kyc:' + userId);
  return v ? JSON.parse(v) : null;
}
async function setKycInfo(userId, info) {
  await redis.set('kyc:' + userId, JSON.stringify(info), 'EX', 600);
}
async function clearKycInfo(userId) { await redis.del('kyc:' + userId); }
async function isWaitingKyc(userId) { return !!(await redis.get('kyc:' + userId)); }
async function startWaitingKyc(userId) {
  await setKycInfo(userId, { name: null, phone: null, bank: null });
}

// ==================== LINE IMAGE ====================

async function getImageBase64(messageId) {
  var res = await fetch('https://api-data.line.me/v2/bot/message/' + messageId + '/content', {
    headers: { Authorization: 'Bearer ' + LINE_TOKEN },
  });
  if (!res.ok) throw new Error('Cannot fetch image: ' + res.status);
  var buf = await res.buffer();
  return buf.toString('base64');
}

// ==================== VISION AI ====================

async function analyzeImage(base64) {
  var visionPrompt = [
    'ดูรูปแล้วตอบ code เดียวเท่านั้น ห้ามพูดอะไรเพิ่ม:',
    '##SLIP## = สลิปโอนเงิน (มีโลโก้ธนาคาร + ชื่อคน + ยอดเงิน)',
    '##SLIP_FAIL## = error ฝากเงิน (QR หมดอายุ/ทำรายการไม่สำเร็จ)',
    '##RESET## = หน้า login ที่ error หรือเข้าไม่ได้',
    '##WEB## = หน้าเว็บปกติ',
    '##UNKNOWN## = อื่นๆ',
    'กฎ: เห็นยอดเงิน+ชื่อคน+ธนาคาร = ##SLIP## ทันที',
  ].join('\n');

  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      system: visionPrompt,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: 'ตอบ code เดียว:' },
      ]}],
    }),
  });
  var data = await res.json();
  var reply = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text.trim() : '##UNKNOWN##';
  console.log('VISION:', reply);
  return reply;
}

async function aiChat(userMsg, history) {
  var histText = history.length > 0
    ? history.map(function(h) { return (h.role === 'user' ? 'ลูกค้า' : 'บอท') + ': ' + (h.content || ''); }).join('\n')
    : '';

  var lines = [
    'คุณคือ "น้องนีน่า" แอดมินเว็บพนันออนไลน์ ผู้หญิง น่ารัก บริการดีมาก',
    '',
    '## วิธีคิดก่อนตอบ (หัวใจสำคัญ)',
    'ก่อนตอบทุกครั้ง ให้คิด:',
    '1. ลูกค้าต้องการอะไรกันแน่? (อ่านความหมาย ไม่ใช่แค่คำ)',
    '2. มีปัญหาอะไรที่ต้องแก้ไหม?',
    '3. context คุยเรื่องอะไรอยู่?',
    'แล้วค่อยตอบให้ตรงจุด',
    '',
    '## ข้อมูลที่รู้จัก',
    'ฝากขั้นต่ำ 1 บาท | ถอนขั้นต่ำ 10 บาท',
    'เทิร์น = เล่น 50% ของยอดฝากก่อนถอน เช่น ฝาก 100 เล่น 50 แล้วถอนได้',
    'แคชแบ็ก = สล็อต 10% คาสิโน 5% ยิงปลา 5% ตัดยอด 23.30 น. เงินเข้า 00.00 น. รอ 30 นาที',
    'โปร/แจก = LINE @454npgay',
    'ถอน = ปกติ 2-10 นาที',
    'ฝาก = โอนผ่านธนาคารหรือ TrueMoney Wallet ฝากขั้นต่ำ 10 บาท เงินเข้า 1-3 นาที',
    'ฝากผ่านธนาคารหรือ TrueMoney Wallet ก็ได้ค่ะ ฝากขั้นต่ำ TrueMoney 10 บาท',
    'ชื่อบัญชีต้องตรงกับชื่อที่สมัคร ถ้าชื่อไม่ตรงจะฝากถอนไม่ได้',
    'แนบสลิปไม่ได้ = ส่งสลิปในแชท + เบอร์ แอดมินแนบให้',
    'โค้ด/คูปอง = กดโลโก้กลางด้านล่างเว็บ',
    'เกม = สล็อต (PG, Joker, PP, AMB และอีกกว่า 20 ค่าย), คาสิโนสด (Sexy Gaming, SA Gaming, Pretty Gaming, WM, Evolution, Allbet), กีฬา (SBOBET, RB7, SABA), ยิงปลา (JILI), หวย, ไฮโล, รูเล็ต',
    'แต้มสะสม/Loyalty = แลกได้ที่ร้านค้าหน้าเว็บ',
    'โค้ด/คูปอง = กดโลโก้กลางด้านล่างเว็บ → ใช้คูปอง (เปิดปกติ)',
    'ของแจก/เครดิตฟรี/โปร = ติดต่อ LINE @454npgay (แยกจากแต้ม)',
    'แนะนำเพื่อน = คำนวณจากยอดฝากเพื่อน 0.7% (ฝากแบบไม่รับโบนัสเท่านั้น) กดรับทุกวันศุกร์หลัง 00.30น. ถอนขั้นต่ำ 1 บาท ทำยอด 10 เท่า ถอนได้ 1 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน ผิดกฎงดถอน ไปที่เมนูอื่นๆ-แนะนำเพื่อน',
    'ลิงก์แนะนำเพื่อน = อยู่ในหน้า "แนะนำเพื่อน" ในเว็บ คัดลอกลิงก์ส่งให้เพื่อนกดสมัครได้เลย',
    'ไม่มีมีกลุ่ม TG: https://t.me/+4Kdjj4YtrFY5NmRl | ซอลญ่า คือ LINE @757xinte',
    '',
    '## โปรโมชั่นทั้งหมด (ตอบเต็มๆ ตามนี้เลย ห้ามสรุปย่อ)',
    '',
    '### ยอดเสีย/คืนยอดเสีย',
    'ถ้าลูกค้าถามยอดเสีย/แคชแบ็ก ส่งข้อความนี้เต็มๆ ทุกตัวอักษร:',
    '📝เงื่อนไขคืนยอดเสียหน้าเว็บ📝',
    'สล็อตคืนยอดเสีย 𝟏𝟎%',
    '-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า-',
    '(เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ผิดกฎงดถอน)',
    'คาสิโน+ยิงปลา คืนยอดเสีย 𝟓%',
    '-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า',
    '-ต้องมียอดเดิมพันอย่างน้อย 𝟓 ไม้ ห้าม 𝐀𝐋𝐋 𝐈𝐍',
    'กดรับยอดเสียได้ทุกวันหลังเวลา 𝟐𝟑.𝟑𝟎น.เป็นต้นไปนะคะ',
    'ไปที่เมนูอื่นๆ-รับยอดเสีย',
    '',
    '### คอมมิชชั่น',
    'หมวดกีฬา รับค่าคอมมิชชั่น 1% ทำยอด 4 เท่า ถอนได้ 1 เท่า ไปที่เมนูอื่นๆ-คอมมิชชั่น',
    '',
    '### โปรเคลมบิล/สลิปแลกเครดิต',
    'เติม 50 รับเพิ่ม 50 | เติม 100 รับเพิ่ม 100 | เติม 300 รับเพิ่ม 300 | เติม 500 รับเพิ่ม 500 | เติม 1,000 รับเพิ่ม 1,000',
    'เล่นได้ เล่นเสียนำมาเคลมฟรี เคลมบิลได้ที่ https://shorturl.asia/718L9',
    '',
    '### โปรฝากประจำ/ฝากต่อเนื่อง',
    'สะสมครบ 3 วันรับ 100 | สะสมครบ 7 วันรับ 500 | สะสมครบ 15 วันรับ 1,000 | สะสมครบ 30 วันรับ 2,000',
    'ทำยอด 10 เท่า ถอนได้ 1 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน ฝากแบบไม่รับโปรโมชั่นเท่านั้น ต้องมียอดฝากขั้นต่ำ 300/วัน',
    '',
    '### รับแต้มเพชรฟรี/กงล้อ',
    'เครดิตกงล้อใช้ 30 แต้ม หมุน 1 ครั้ง สะสมเครดิตได้สูงสุด 10,000 เครดิต ทำเทิร์น 10 เท่า ถอนได้ 1 เท่า เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ไปที่เมนูอื่นๆ-รับแต้มเพชรฟรี',
    '',
    '### โปรวันเกิด',
    'รับเครดิตฟรี 300 บาท เป็นสมาชิกอย่างน้อย 15 วัน ภายใน 7 วันก่อนรับโปรต้องมียอดฝากและเล่น 300 บาทขึ้นไป ถ่ายรูปบัตรประชาชนชื่อตรงกับข้อมูลสมัคร แจ้งยูสเซอร์ส่งหลักฐานให้แอดมิน ทำเทิร์น 4 เท่าถอนได้เลย ไม่จำกัดถอน จำกัด 1 สิทธิ์ 1 ยูส/ปี',
    '',
    '### เช็คอิน',
    'ฝากบิล 100 รับฟรี 50 ทำยอด 10 เท่า ถอนได้ 50 บาท กด "ฝากเงินเพื่อรับรางวัล" ก่อนทำรายการฝาก เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ไปที่เมนูอื่นๆ-เช็คอิน',
    '',
    '### แรงค์กิ้ง (Ranking)',
    'BRONZE-I เริ่มต้น-ยอดฝาก 5,000',
    'GOLD-I ยอดฝากสะสม 5,000 รับ 500 เครดิต ทำเทิร์น 10 เท่า ถอนได้ 1 เท่า',
    'PLATINUM-I ยอดฝากสะสม 10,000 รับ 1,000 เครดิต ทำเทิร์น 10 เท่า ถอนได้ 1 เท่า',
    'DIAMOND-I ยอดฝากสะสม 50,000 รับ 2,500 เครดิต ทำเทิร์น 10 เท่า ถอนได้ 1 เท่า',
    'COMMANDER-I ยอดฝากสะสม 100,000 รับ 10,000 เครดิต ทำเทิร์น 10 เท่า ถอนได้ 1 เท่า',
    'สะสมได้ตลอดชีพ ไม่มีตัดสิทธิ์ เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ไปที่เมนูอื่นๆ-อันดับ',
    '',
    '### ทายผลเลขท้าย',
    'ยอดฝากบิลเดี่ยวขั้นต่ำ 50 บาท = 1 สิทธิ์ ทายได้ไม่จำกัด ปิดทายผล 15.20น. วันหวยออก ทายเลขท้าย 2 ตัวล่าง หรือ 3 ตัวบน ประกาศผลกลุ่มเทเลแกรม 19.00น. ถูกรับเครดิตฟรี 200 บาท ทำยอด 8 เท่า ถอนได้ 2 เท่า',
    '',
    '### ร้านค้าแลกเหรียญ',
    'แต้ม 39,999 แลก iPhone 17 Pro Max 1TB | แต้ม 25,000 แลก Honda Giorno+ 2026 | แต้ม 150,000 แลกทองคำรูปพรรณ 1 บาท ไปที่เมนูอื่นๆ-ร้านค้าแลกเหรียญ',
    '',
    '### สะสมแต้มเพชร',
    'ยอดฝากบิลเดี่ยว 300 บาท รับ 30 แต้มเพชร ใช้หมุนกงล้อหรือแลกซื้อเครดิตที่ร้านค้า ไปที่เมนูอื่นๆ-กงล้อ-ร้านค้าแลกเหรียญ',
    '',
    '### กล่องสุ่ม',
    'ยอดฝากบิลเดี่ยว 300 บาทภายในวัน เปิดกล่องสุ่มได้ 1 ครั้ง ลุ้นรับสูงสุด 5,000 บาท ฝากทุกวันลุ้นได้ทุกวัน',
    'รางวัลที่ 1 CREDIT-FREE 20 ทำยอด 5 เท่า ถอนได้ 2 เท่า',
    'รางวัลที่ 2 CREDIT-FREE 50 ทำยอด 2 เท่า ถอนได้ 4 เท่า',
    'รางวัลที่ 3 CREDIT-FREE 100 ทำยอด 2 เท่า ถอนได้ 4 เท่า',
    'รางวัลที่ 4 CREDIT-FREE 1,000 ทำยอด 1 เท่า ถอนได้ 1 เท่า',
    'รางวัลที่ 5 เงินสด 3,000 ไม่ต้องทำยอด ถอนได้ทันที',
    'รางวัลที่ 6 เงินสด 5,000 ไม่ต้องทำยอด ถอนได้ทันที',
    'ต้องกดรับก่อนฝากเท่านั้น ไปที่เมนูอื่นๆ-กล่องสุ่ม',
    '',
    '### โปรสมาชิกใหม่',
    'รับฟรี 20% ฝากเริ่มต้น 50 สูงสุด 3,000 บาท ทำยอด 10 เท่า ถอนได้ 4 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน รับได้เฉพาะสมาชิกใหม่ 1 ครั้งเท่านั้น',
    '',
    '### โปรนาทีทอง',
    'รับเพิ่ม 10% เฉพาะเวลา 16.00-18.00น. ฝากเริ่มต้น 50 สูงสุด 3,000 บาท ไม่ต้องทำยอด ถอนได้สูงสุด 4 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน รับได้ 1 ครั้ง/วัน',
    '',
    '### Bonustime',
    'รับเพิ่ม 15% เฉพาะเวลา 20.00-22.00น. ฝากเริ่มต้น 50 สูงสุด 3,000 บาท ไม่ต้องทำยอด ถอนได้สูงสุด 3 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน รับได้ 1 ครั้ง/วัน',
    '',
    '### โปรทุนน้อย',
    'ฝาก 30 รับ 100 ทำยอด 10 เท่า ถอนได้ 1 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน รับได้ไม่จำกัดครั้ง/วัน',
    '',
    '### โปรถอนหนัก',
    'ฝาก 50 รับ 200 ทำยอด 10 เท่า ถอนได้ 1 เท่า เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน รับได้ไม่จำกัดครั้ง/วัน',
    '',
    '### โปรไทยช่วยไทยพลัส 60/40',
    'ฝาก 40 เราช่วยจ่าย 60 รับ 100 บาท | ฝาก 400 เราช่วยจ่าย 600 รับ 1,000 บาท ทำยอด 6 เท่า ถอนได้ 2 เท่าของยอดรับโบนัส เล่นสล็อตได้ทุกค่าย ห้ามซื้อฟรีสปิน รับได้ 1 ครั้ง/วัน',
    '',
    '## กฎการตอบเรื่องโปร',
    'ถ้าลูกค้าถามโปรไหน → ส่งข้อมูลโปรนั้นเต็มๆ ตามที่มีข้างบน ห้ามสรุปย่อ',
    'ถ้าลูกค้าถามว่ามีโปรอะไรบ้าง → บอกชื่อโปรทั้งหมดก่อน แล้วถามว่าสนใจโปรไหน',
    '',
    '## สไตล์',
    'ตอบสุภาพและเป็นมืออาชีพ เหมือนแอดมินจริงที่ให้บริการดี',
    'ใช้ ค่ะ/นะคะ/ค่ะ ห้ามใช้ครับ | emoji 1 ตัวพอ ไม่ต้องใส่ทุกประโยค',
    'ตอบตรงประเด็น ชัดเจน ไม่ใช้ภาษาเด็ก ไม่ใช้คำว่า "น้อง" บ่อยเกินไป',
    'ห้ามพูดชื่อเว็บหรือลิงก์ | ตอบยาวเกิน 3 บรรทัด ใส่ ##SPLIT## คั่น',
    'ถ้าลูกค้าเปลี่ยนเรื่อง ให้ตอบเรื่องใหม่ทันที อย่ายึดติดกับเรื่องเดิม',
    '',
    '## Code พิเศษ',
    '##REGISTER## = สมัคร | ##RESET## = ลืมรหัส | ##ASK_SLIP## = ขอสลิป',
    '##FREE_CREDIT## = โปร/แจก | ##ADMIN## = ต้องแอดมิน | ##ESCALATE## = ใช้น้อยมาก',
    '##CASHBACK## = ลูกค้าถามเรื่องแคชแบ็ก/ยอดเสียทุกกรณี — ห้ามตอบเอง ใช้ ##CASHBACK## เสมอ',
    '',
    '## ตัวอย่างการคิด (เรียนรู้วิธีคิด)',
    '"ถอนไปนานแล้วยังไม่ได้" = ปัญหาถอน → รอ 2-10 นาที ถ้าเกินแจ้งน้องได้เลยค่ะ',
    '"ฝากตังไปหายเลย" = ฝากไม่เข้า → ##ASK_SLIP##',
    '"555 แตกเลย" = ดีใจ → เย่ๆ ดีใจด้วยนะคะ 🎉',
    '"รหัสมันไม่ยอมเข้า" = login ไม่ได้ → ##RESET##',
    '"มีให้เล่นอะไรบ้าง" = ถามเกม → มีสล็อต บาคาร่า กีฬา หวย คาสิโนสดค่ะ',
    '"ขั้นต่ำเท่าไหร่" (context ฝาก) = ฝากขั้นต่ำ → 50 บาทค่ะ',
    '"ขั้นต่ำเท่าไหร่" (context ถอน) = ถอนขั้นต่ำ → 100 บาทค่ะ',
    '"โอเค/ได้ครับ/ขอบคุณ" = จบแล้ว → ค่า 💕',
    '"รับยอดเสียยังไง" = ##CASHBACK## (ห้ามตอบเองเด็ดขาด)',
    '"ดูยอดเสียตรงไหน" = ##CASHBACK## (ห้ามบอกให้ไปดูเว็บเอง)',
    '"จะได้แคชแบ็กเท่าไหร่" = ##CASHBACK## (ห้ามตอบเองเด็ดขาด)',
    '"เสียไปเยอะมาก" หรือพูดถึงการเสียเงิน = ##CASHBACK##',
  ];

  var systemPrompt = lines.join('\n') +
    '\n\nข้อมูลเพิ่มเติม:\n' +
    'ถ้าลูกค้าถามว่าระบบอัพเดท/ปิดปรับปรุง/ล่ม/ใช้งานได้ไหม → ตอบว่าระบบปกติใช้งานได้ค่ะ ถ้ามีปัญหาแจ้งน้องได้เลย\n' +
    'ถ้าลูกค้าถามเรื่องที่ไม่รู้ → ตอบตามความเป็นจริงสั้นๆ ไม่ต้องถามกลับ\n' +
    'ถามกลับเฉพาะตอนที่ไม่รู้จริงๆ ว่าลูกค้าต้องการอะไร เท่านั้น ห้ามถามกลับบ่อย\n' +
    '\n\n## กฎเด็ดขาดเรื่องการตอบ\n' +
    'ห้ามเขียนขั้นตอนคิด ห้ามใส่ "คิด:" หรือ "วิเคราะห์:" หรืออะไรทำนองนี้ในคำตอบ\n' +
    'ตอบแค่ข้อความที่จะส่งให้ลูกค้าอ่านโดยตรงเท่านั้น ไม่มีคำอธิบายอื่นใดๆ\n' +
    'คิดในใจ แล้วพิมพ์ออกมาแค่คำตอบสุดท้ายที่ลูกค้าจะเห็น\n' +
    'ห้ามแปลงเวลาเป็น "ทุ่ม" หรือ "ตี" ให้ใช้ตัวเลข 24 ชั่วโมงเท่านั้น เช่น 23.00 น. และ 00.00 น.\n';

  var wdStatus = isWithdrawClosed();
  if (wdStatus.closed) {
    systemPrompt += '\n\n## ⚠️ สถานการณ์ปัจจุบัน (สำคัญมาก)\n' +
      'ขณะนี้ระบบถอนเงินปิดชั่วคราวเนื่องจากธนาคารปรับปรุงระบบ\n' +
      'ถ้าลูกค้าถามเรื่องถอน ให้แจ้งว่าธนาคารปรับปรุงระบบ รอถึง ' + wdStatus.until.split(' ')[1] + ' น.\n' +
      'ย้ำว่าเงินปลอดภัย 100% และฝากได้ตามปกติ\n' +
      'ห้ามบอกว่าถอนได้ตามปกติ เพราะตอนนี้ถอนไม่ได้\n';
  }

  var context = histText ? 'บทสนทนา:\n' + histText + '\n\n' : '';
  var userContent = context + 'ลูกค้า: "' + userMsg + '"\n\nตอบสั้นๆ เหมือนแอดมินจริง (ส่งแค่คำตอบ ห้ามมีคำอธิบายขั้นตอนคิด):';

  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  var data = await res.json();
  var reply = (data.content && data.content[0] && data.content[0].text) ? data.content[0].text.trim() : '##ESCALATE##';
  reply = reply.replace(/\\n/g, '\n');
  reply = reply.replace(/^\*?\*?(คิด|วิเคราะห์|Think|Analysis)[:：][\s\S]*?(?:\n---\n|\n\n)/i, '').trim();
  reply = reply.replace(/^\*\*(คิด|วิเคราะห์)[:：]\*\*[\s\S]*?\n\n/i, '').trim();
  console.log('AI:', reply.substring(0, 80));
  return reply;
}

// ==================== GITHUB ====================

async function ghGet(filename) {
  var url = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + filename;
  var res = await fetch(url, { headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github.v3+json' } });
  if (!res.ok) throw new Error('ghGet failed: ' + res.status);
  var data = await res.json();
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

async function ghPush(filename, content, sha, msg) {
  var url = 'https://api.github.com/repos/' + GITHUB_REPO + '/contents/' + filename;
  var res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: 'Bearer ' + GITHUB_TOKEN, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg || 'auto: update', content: Buffer.from(content).toString('base64'), sha }),
  });
  if (!res.ok) throw new Error('ghPush failed: ' + await res.text());
}

async function aiPatch(code, instruction) {
  var res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: 'คุณเป็น senior Node.js developer\nรับคำสั่งไทยและโค้ด ตอบเป็น JSON array เท่านั้น\nรูปแบบ: [{"find":"ข้อความเดิม","replace":"ข้อความใหม่"}]\nกฎ: find ต้องเป็น exact string ห้าม regex',
      messages: [{ role: 'user', content: 'คำสั่ง: ' + instruction + '\n\nโค้ด:\n' + code + '\n\nส่ง JSON:' }],
    }),
  });
  var data = await res.json();
  if (!data.content || !data.content[0]) throw new Error('AI ไม่ตอบ');
  var raw = data.content[0].text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  var patches = JSON.parse(raw);
  if (!Array.isArray(patches) || patches.length === 0) throw new Error('ไม่มี patch');
  return patches;
}

function applyPatches(code, patches) {
  var newCode = code;
  var results = [];
  for (var p of patches) {
    if (!p.find || p.replace === undefined) { results.push('⚠️ patch ไม่สมบูรณ์'); continue; }
    if (!newCode.includes(p.find)) { results.push('❌ หาไม่เจอ: "' + p.find.substring(0, 50) + '"'); continue; }
    newCode = newCode.replace(p.find, p.replace);
    results.push('✅ แก้: "' + p.find.substring(0, 40) + '"');
  }
  return { newCode, results };
}

async function handleUpdate(instruction) {
  await tgMain('\u23F3 กำลังดำเนินการ...');
  var { content: code, sha } = await ghGet('index.js');
  var patches = await aiPatch(code, instruction);
  await tgMain('\u2705 พบ ' + patches.length + ' จุด กำลัง apply...');
  var { newCode, results } = applyPatches(code, patches);
  var hasErr = results.some(function(r) { return r.startsWith('❌'); });
  if (hasErr) { await tgMain('⚠️ patch มีปัญหา:\n' + results.join('\n')); return; }
  if (!newCode.includes('app.listen') || !newCode.includes('/webhook')) { await tgMain('❌ โค้ดผิดปกติ ยกเลิก'); return; }
  await ghPush('index.js', newCode, sha, 'patch: ' + instruction.substring(0, 70));
  await tgMain('\u{1F389} Deploy สำเร็จ! Render กำลัง deploy 1-2 นาที\n\n' + results.join('\n'));
}

// ==================== MAIN LINE EVENT HANDLER ====================

async function handleEvent(event) {
  if (event.type !== 'message') return;
  if (event.mode === 'standby') return;

  var userId = event.source.userId;
  var replyToken = event.replyToken;
  var msgType = event.message.type;
  var msgText = msgType === 'text' ? event.message.text : '';
  var ts = event.timestamp || Date.now();

  if (await isDup(replyToken)) return;
  if (await isStopped(userId)) return;
  if (await isRateLimited(userId)) return;

  var displayName = await getDisplayName(userId);
  console.log('MSG:', msgText.substring(0, 50), '| USER:', displayName);

  tgNotifyOnce(displayName, msgText || '[รูป/สติกเกอร์]', ts, userId).catch(function() {});

  var lastSeen = await getLastSeen(userId);
  var isInactive = lastSeen > 0 && Date.now() - lastSeen > TWO_HOURS_MS;
  await setLastSeen(userId);

  // ====== STICKER ======
  if (msgType === 'sticker') {
    await lineReply(replyToken, txt(randomPick(['\u{1F495}', '😊', '\u2728'])));
    return;
  }

  // ====== FILE/VIDEO/AUDIO ======
  if (msgType === 'video' || msgType === 'audio' || msgType === 'file') {
    var mediaKey = 'media:' + userId;
    if (!(await redis.get(mediaKey))) {
      await redis.set(mediaKey, '1', 'EX', 60);
      await lineReply(replyToken, txt('มีอะไรให้น้องนีน่าช่วยไหมคะ? \u{1F495}'));
    }
    return;
  }

  // ====== IMAGE ======
  if (msgType === 'image') {
    if (await imgDup(userId)) return;
    await new Promise(function(r) { setTimeout(r, 300); });

    try {
      var base64 = await getImageBase64(event.message.id);
      var vision = await analyzeImage(base64);

      if (vision.includes('##SLIP##')) {
        var curState = await getSlipState(userId);

        if (curState && (curState.step === 'waiting_info' || curState.step === 'waiting_confirm')) {
          var alreadyAskedSlip = await redis.get('asked_info:' + userId);
          if (alreadyAskedSlip || await isHandled(userId)) {
            await clearSlipState(userId);
            await tgSlipAlert(displayName, 'ลูกค้าส่งสลิปมาในแชท (แนบที่เว็บไม่ได้)');
            await markHandled(userId);
            var slipInChatMsg = 'รับสลิปแล้วค่ะ \u{1F4CB}\nน้องนีน่ากำลังดำเนินการให้นะคะ \u23F0';
            await lineReply(replyToken, txt(slipInChatMsg));
            await addHistory(userId, 'bot', slipInChatMsg);
          } else {
            await redis.set('asked_info:' + userId, '1', 'EX', 3600);
            await setSlipState(userId, { step: 'waiting_info', ts: Date.now() });
            var needPhoneMsg = 'รับสลิปแล้วค่ะ \u{1F4CB}\nขอเบอร์โทรหรือเลขบัญชีธนาคารด้วยนะคะ น้องแนบให้เองเลยค่ะ \u{1F495}';
            await lineReply(replyToken, txt(needPhoneMsg));
            await addHistory(userId, 'bot', needPhoneMsg);
          }
        } else {
          var slipMsg = 'เอาสลิปนี้ไปแนบที่หน้าเว็บด้วยนะคะ \u{1F4F1}\nเงินจะเข้าอัตโนมัติภายใน 1-3 นาทีค่ะ';
          await lineReply(replyToken, txt(slipMsg));
          await setSlipState(userId, { step: 'waiting_confirm', ts: Date.now() });
          await markSlipSent(userId);
          await addHistory(userId, 'bot', slipMsg);
        }
        return;
      }

      if (vision.includes('##SLIP_FAIL##')) {
        var failMsg = 'ขอสลิปการโอนเงินมาด้วยนะคะ \u{1F4B8}';
        await lineReply(replyToken, txt(failMsg));
        await setSlipState(userId, { step: 'waiting_slip', ts: Date.now() });
        await addHistory(userId, 'bot', failMsg);
        return;
      }

      if (vision.includes('##RESET##')) {
        var resetMsg = 'ขอข้อมูลรีรหัสนะคะ \u{1F511}\n\nชื่อที่ใช้สมัคร\nเบอร์โทร\nเลขบัญชีธนาคาร';
        await lineReply(replyToken, txt(resetMsg));
        await startWaitingReset(userId);
        await addHistory(userId, 'bot', resetMsg);
        return;
      }

      if (vision.includes('##WEB##')) {
        var webMsg2 = 'มาทำรายการอะไรคะ? \u{1F495}';
        await lineReply(replyToken, txt(webMsg2));
        await addHistory(userId, 'bot', webMsg2);
        return;
      }

      var recentHist = await getHistory(userId);
      var recentText = recentHist.map(function(h) { return h.content || ''; }).join(' ');
      var isDepositCtx = ['ฝาก','โอน','สลิป','เงิน','ยอดไม่เข้า','ฝากไม่เข้า','ฝากเงิน','deposit'].some(function(w) {
        return recentText.includes(w) || msgText.includes(w);
      });

      if (isDepositCtx) {
        var slipFbMsg = 'เอาสลิปนี้ไปแนบที่หน้าเว็บด้วยนะคะ \u{1F4F1}\nเงินจะเข้าอัตโนมัติภายใน 1-3 นาทีค่ะ';
        await lineReply(replyToken, txt(slipFbMsg));
        await setSlipState(userId, { step: 'waiting_confirm', ts: Date.now() });
        await markSlipSent(userId);
        await addHistory(userId, 'bot', slipFbMsg);
      } else {
        var askMsg2 = 'มาทำรายการอะไรคะ? \u{1F495}';
        await lineReply(replyToken, txt(askMsg2));
        await addHistory(userId, 'bot', askMsg2);
      }

    } catch (e) {
      console.log('IMAGE ERROR:', e.message);
      await tgAlert(displayName, '[รูปภาพ-error]', ts, userId);
      await lineReply(replyToken, txt('ดูรูปไม่ชัดค่ะ ลองส่งใหม่ได้นะคะ \u{1F4F7}'));
    }
    return;
  }

  // ====== ไม่ active 2 ชั่วโมง ======
  if (isInactive) {
    await lineReply(replyToken, txt('มีอะไรให้น้องนีน่าช่วยไหมคะ? \u{1F495}'));
    return;
  }

  // ====== TEXT ======
  if (msgType !== 'text' || !msgText.trim()) return;

  if (await isRepeatedMsg(userId, msgText.trim())) {
    console.log('REPEATED MSG - skip');
    return;
  }

  await new Promise(function(r) { setTimeout(r, 1500); });

  // ====== STATE: รอ reset info ======
  if (await isWaitingReset(userId)) {
    if (await isResetCD(userId)) {
      await clearResetInfo(userId);
    } else if (isDone(msgText)) {
      await clearResetInfo(userId);
      await lineReply(replyToken, txt('หากคุณพี่ติดปัญหาด้านใดติดต่อแอดมิน 𝟐𝟒 ชม.นะคะ🥰'));
      return;
    } else if (isDeposit(msgText) || isWithdraw(msgText)) {
      await clearResetInfo(userId);
    } else {
      var info = await getResetInfo(userId);
      var ex = extractContact(msgText);
      if (ex.phone && !info.phone) info.phone = ex.phone;
      if (ex.bank && !info.bank) info.bank = ex.bank;
      if (ex.name && !info.name) info.name = ex.name;

      var walletWords = ['ทรูมันนี่','truemoney','true money','ทูมันนี่','wallet','วอลเลท','วอลเล็ท','promptpay','พร้อมเพย์'];
      var hasWallet = walletWords.some(function(w) { return msgText.toLowerCase().includes(w); });
      if (hasWallet) {
        var walletMsg = 'รองรับทุกธนาคารค่ะ\nขอเลขบัญชีธนาคารด้วยนะคะ 📋';
        await lineReply(replyToken, txt(walletMsg));
        await addHistory(userId, 'bot', walletMsg);
        return;
      }

      if (info.phone || info.bank) {
        // มีเบอร์หรือบัญชีอย่างใดอย่างหนึ่ง → ดำเนินการได้เลย
        var summary = [
          info.name ? 'ชื่อ: ' + info.name : null,
          info.phone ? 'เบอร์: ' + info.phone : null,
          info.bank  ? 'บัญชี: ' + info.bank  : null,
          'ข้อความ: ' + msgText,
        ].filter(Boolean).join('\n');
        await clearResetInfo(userId);
        await tgReset(displayName, summary);
        await setResetCD(userId);
        var doneReset = '🙏แอดมินกำลังดำเนินการ รบกวนคุณพี่รอสักครู่นะคะ⏳';
        await lineReply(replyToken, txt(doneReset));
        await addHistory(userId, 'bot', doneReset);

      } else {
        await setResetInfo(userId, info);
        await lineReply(replyToken, txt('🙏รบกวนแจ้งเบอร์โทร หรือเลขบัญชีธนาคารสักอย่างนะคะ เพื่อให้แอดมินดำเนินการให้ได้ค่ะ'));
      }
      return;
    }
  }

  // ====== STATE: รอข้อมูล KYC ======
  if (await isWaitingKyc(userId)) {
    if (isDone(msgText)) {
      await clearKycInfo(userId);
      await lineReply(replyToken, txt('หากคุณพี่ติดปัญหาด้านใดติดต่อแอดมิน 𝟐𝟒 ชม.นะคะ🥰'));
      return;
    }

    var kycInfo = await getKycInfo(userId);
    var kycEx = extractContact(msgText);
    if (kycEx.phone && !kycInfo.phone) kycInfo.phone = kycEx.phone;
    if (kycEx.bank  && !kycInfo.bank)  kycInfo.bank  = kycEx.bank;
    if (kycEx.name  && !kycInfo.name)  kycInfo.name  = kycEx.name;

    if (kycInfo.phone || kycInfo.bank) {
      // มีเบอร์หรือบัญชีอย่างใดอย่างหนึ่ง → ดำเนินการได้เลย
      var kycSummary = [
        kycInfo.name  ? 'ชื่อ: ' + kycInfo.name : null,
        kycInfo.phone ? 'เบอร์: ' + kycInfo.phone : null,
        kycInfo.bank  ? 'บัญชี: ' + kycInfo.bank  : null,
        'ข้อความ: ' + msgText,
      ].filter(Boolean).join('\n');
      await clearKycInfo(userId);
      await tgKycAlert(displayName, kycSummary);
      var kycDoneMsg = 'แอดมินกำลังดำเนินการ รบกวนรอสักครู่นะคะ\u23F0';
      await lineReply(replyToken, txt(kycDoneMsg));
      await addHistory(userId, 'bot', kycDoneMsg);

    } else {
      await setKycInfo(userId, kycInfo);
      await lineReply(replyToken, txt('🙏รบกวนแจ้งเบอร์โทร หรือเลขบัญชีธนาคารสักอย่างนะคะ เพื่อให้แอดมินดำเนินการให้ได้ค่ะ'));
    }
    return;
  }

  // ====== STATE: รอ slip ======
  var slipState = await getSlipState(userId);

  if (slipState && slipState.step === 'waiting_confirm') {
    if (isDone(msgText)) {
      await clearSlipState(userId);
      await clearSlipSent(userId);
      await lineReply(replyToken, txt('หากคุณพี่ติดปัญหาด้านใดติดต่อแอดมิน 𝟐𝟒 ชม.นะคะ🥰'));
      return;
    }

    var hasProblem = ['ไม่เข้า','ไม่ได้','แนบไม่','อัปโหลด','เลือกรูป','ยังไม่','ไม่มา',
      'ฝากเงิน','แจ้งฝาก','ฝากไม่','เงินไม่','ยอดไม่','ตามยอด','เช็คยอด',
      'เงินเข้าไหม','ยอดเข้าไหม'].some(function(w){ return msgText.toLowerCase().includes(w); });

    var exCon = extractContact(msgText);
    if (exCon.phone || exCon.bank) {
      await clearSlipState(userId);
      var conSum = [
        exCon.phone ? 'เบอร์: ' + exCon.phone : null,
        exCon.bank  ? 'บัญชี: ' + exCon.bank  : null,
        'ข้อความ: ' + msgText,
      ].filter(Boolean).join('\n');
      await tgSlipAlert(displayName, conSum);
      await markHandled(userId);
      var doneMsg = 'รับแล้วค่ะ \u{1F4CB}\nน้องนีน่ากำลังดำเนินการให้นะคะ \u23F0';
      await lineReply(replyToken, txt(doneMsg));
      await addHistory(userId, 'bot', doneMsg);
      return;
    }

    if (hasProblem || isSlipAlreadySent(msgText)) {
      var alreadyAsked = await redis.get('asked_info:' + userId);
      if (!alreadyAsked) {
        await redis.set('asked_info:' + userId, '1', 'EX', 3600);
        await setSlipState(userId, { step: 'waiting_info', ts: Date.now() });
        var askMsg = 'ขอเบอร์โทรหรือเลขบัญชีธนาคารด้วยนะคะ \u{1F4CB}';
        await lineReply(replyToken, txt(askMsg));
        await addHistory(userId, 'bot', askMsg);
      } else {
        await lineReply(replyToken, txt('น้องนีน่ากำลังดำเนินการให้อยู่นะคะ รอสักครู่ค่ะ \u23F0'));
      }
      return;
    }

    await clearSlipState(userId);
  }

  if (slipState && slipState.step === 'waiting_info') {
    if (isDone(msgText)) {
      await clearSlipState(userId);
      await clearSlipSent(userId);
      await clearHandled(userId);
      await redis.del('asked_info:' + userId);
      await lineReply(replyToken, txt('หากคุณพี่ติดปัญหาด้านใดติดต่อแอดมิน 𝟐𝟒 ชม.นะคะ🥰'));
      return;
    }

    var exInfo = extractContact(msgText);
    if (exInfo.phone || exInfo.bank) {
      await clearSlipState(userId);
      var infoSum = [
        exInfo.phone ? 'เบอร์: ' + exInfo.phone : null,
        exInfo.bank  ? 'บัญชี: ' + exInfo.bank  : null,
        'ข้อความ: ' + msgText,
      ].filter(Boolean).join('\n');
      await tgSlipAlert(displayName, infoSum);
      await markHandled(userId);
      var doneInfo = 'รับแล้วค่ะ \u{1F4CB}\nน้องนีน่ากำลังดำเนินการให้นะคะ \u23F0';
      await lineReply(replyToken, txt(doneInfo));
      await addHistory(userId, 'bot', doneInfo);
      return;
    }

    var stillProblem = ['ยังไม่เข้า','ไม่เข้าเลย','ยังไม่ได้','ยังไม่มา','ยังไม่เห็น',
      'ไม่เข้านะ','ไม่เข้าครับ','ไม่เข้าค่ะ','ยืนยัน'].some(function(w){ return msgText.includes(w); });

    if (stillProblem && await isHandled(userId)) {
      var urgentText = '\u{1F6A8}\u{1F6A8} ลูกค้ายืนยันว่ายังไม่เข้า!\nชื่อไลน์: ' + displayName + '\nข้อความ: ' + msgText + '\n\n⚡ ช่วยตรวจสอบด่วนด้วยครับ';
      await tgMain(urgentText, stopResumeMarkup(userId));
      await tgMain(urgentText, stopResumeMarkup(userId));
      await lineReply(replyToken, txt('รับทราบแล้วค่ะ น้องนีน่าส่งเรื่องให้แอดมินด่วนแล้วนะคะ \u23F0\nรอสักครู่นะคะ'));
      return;
    }

    if (await isHandled(userId)) {
      await lineReply(replyToken, txt('น้องนีน่ากำลังดำเนินการให้อยู่นะคะ รอสักครู่ค่ะ \u23F0'));
      return;
    }

    await lineReply(replyToken, txt('ขอเบอร์โทรหรือเลขบัญชีธนาคารด้วยนะคะ \u{1F4CB}'));
    return;
  }

  if (slipState && slipState.step === 'waiting_slip') {
    if (isDone(msgText)) { await clearSlipState(userId); return; }
    return;
  }

  // ====== STATE: รอยอดเสียเพื่อคำนวนแคชแบ็ก ======
  if (await isCashbackState(userId)) {
    // ลูกค้าเปลี่ยนเรื่อง → clear แล้วไหลต่อ
    var cbOtherTopic = isDeposit(msgText) || isWithdraw(msgText) || isReset(msgText) || isKyc(msgText) ||
      isRegister(msgText) || isFollowUp(msgText) ||
      ['ถอน','ฝาก','สมัคร','รหัส','แนะนำเพื่อน','ค่าคอม','คอมมิชชั่น',
       'เช็คอิน','แรงค์','ranking','กล่องสุ่ม','วันเกิด','ทายผล','โปร'].some(function(w){ return msgText.toLowerCase().includes(w); });
    if (cbOtherTopic) {
      await clearCashbackState(userId);
      // ไม่ return ให้ไหลต่อ
    } else {
      var lossNum = msgText.replace(/,/g, '').match(/\d+(\.\d+)?/);
      if (lossNum) {
        var loss = parseFloat(lossNum[0]);
        var cashback = Math.floor(loss * 0.10);
        await clearCashbackState(userId);
        var cbMsg = 'ยอดเสีย ' + loss.toLocaleString() + ' บาท ได้รับคืน ' + cashback.toLocaleString() + ' บาทค่ะ\nเงินเข้าอัตโนมัติหลัง 00.00 น. รอประมาณ 30 นาทีนะคะ';
        await lineReply(replyToken, txt(cbMsg));
        await addHistory(userId, 'bot', cbMsg);
        return;
      }
      if (isDone(msgText)) {
        await clearCashbackState(userId);
        await lineReply(replyToken, txt('หากคุณพี่ติดปัญหาด้านใด สามารถติดต่อแอดมินได้ตลอด 24 ชั่วโมงนะคะ'));
        return;
      }
      await lineReply(replyToken, txt('กรุณาแจ้งยอดเสียมาได้เลยค่ะ น้องจะคำนวณให้ทันทีเลยค่ะ'));
      return;
    }
  }

  // ====== แนะนำเพื่อน ======
  var referralWords = ['แนะนำเพื่อน','ชวนเพื่อน','พาเพื่อน','referral','รีเฟอรัล','ลิงก์เพื่อน','ลิ้งเพื่อน','แชร์เพื่อน','เพื่อนเล่น','เพื่อนสมัคร','ได้จากเพื่อน','ได้ยอดเพื่อน'];
  var isReferralQ = referralWords.some(function(w) { return msgText.toLowerCase().includes(w); });
  if (isReferralQ) {
    var refMsg = '\u{1F91D} เงื่อนไขรับเครดิตแนะนำเพื่อน\n\n✅ คำนวณจากยอดฝากเพื่อน 0.7%\n✅ กดรับได้ทุกวันศุกร์หลังเวลา 00.30 น.เป็นต้นไป\n\n🏧 ถอนขั้นต่ำ 1 บาท ทำยอด 10 เท่า ถอนได้ 1 เท่า\n(เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ผิดกฎงดถอน)\n\nไปที่เมนูอื่นๆ → แนะนำเพื่อน\nลิงก์แนะนำเพื่อนอยู่ที่หน้า "แนะนำเพื่อน" ในเว็บค่ะ กดก็อปลิงก์ส่งให้เพื่อนสมัครได้เลยนะคะ';
    await lineReply(replyToken, txt(refMsg));
    await addHistory(userId, 'bot', refMsg);
    return;
  }

  // ====== แคชแบ็ก ======
  var cashbackWords = [
    'แคชแบ็ก','cashback','ยอดเสีย','คืนยอด','รับยอดเสีย','ได้ยอดเสีย',
    'โบนัสเสีย','เสียได้คืน','รับยอดเสียยังไง','รับยอดเสียได้ไหม',
    'ดูยอดเสีย','เช็คยอดเสีย','ยอดเสียได้คืน','เสียแล้วได้อะไร',
    'เสียได้ไหม','จะได้คืนไหม','เสียได้คืนไหม',
  ];
  var isCashbackQ = cashbackWords.some(function(w) { return msgText.toLowerCase().includes(w); });

  if (isCashbackQ) {
    var lossMsg = '📝เงื่อนไขคืนยอดเสียหน้าเว็บ📝\nสล็อตคืนยอดเสีย 𝟏𝟎%\n-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า-\n(เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ผิดกฎงดถอน)\n\nคาสิโน+ยิงปลา คืนยอดเสีย 𝟓%\n-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า\n-ต้องมียอดเดิมพันอย่างน้อย 𝟓 ไม้ ห้าม 𝐀𝐋𝐋 𝐈𝐍\n\nกดรับยอดเสียได้ทุกวันหลังเวลา 𝟐𝟑.𝟑𝟎น.เป็นต้นไปนะคะ\n\nไปที่เมนูอื่นๆ-รับยอดเสีย';
    await lineReply(replyToken, txt(lossMsg));
    await addHistory(userId, 'bot', lossMsg.substring(0, 80));
    return;
  }

  // ====== เช็คช่วงปิดถอน ======
  var withdrawStatus = isWithdrawClosed();
  var isAskWithdraw = isWithdraw(msgText) || msgText.includes('ถอน');

  if (withdrawStatus.closed && isAskWithdraw) {
    var closedMsg = formatWithdrawClosedMsg(withdrawStatus.until, msgText);
    await lineReply(replyToken, txt(closedMsg));
    await addHistory(userId, 'bot', closedMsg);
    return;
  }

  // ====== keyword check 3 เรื่องสำคัญ ======

  // 1. ยกเลิกถอน
  if (msgText.includes('ยกเลิกการถอน') || msgText.includes('ยกเลิกถอน')) {
    if (withdrawStatus.closed) {
      var closedCancelMsg = formatWithdrawClosedMsg(withdrawStatus.until, msgText);
      await lineReply(replyToken, txt(closedCancelMsg));
      await addHistory(userId, 'bot', closedCancelMsg);
    } else {
      await tgAlert(displayName, 'ยกเลิกการถอน: ' + msgText, ts, userId);
      var cancelMsg2 = 'รับเรื่องแล้วค่ะ \u{1F4CB}\nน้องนีน่ากำลังดำเนินการให้นะคะ \u23F0';
      await lineReply(replyToken, txt(cancelMsg2));
      await addHistory(userId, 'bot', cancelMsg2);
    }
    return;
  }

  // 2. ถอนเกิน 10 นาที
  var withdrawOverdue = ['เกินแล้ว','นานมากแล้ว','เกิน 10','มันไม่เข้า','ยังไม่เข้าเลย'].some(function(w) { return msgText.includes(w); });
  if (withdrawOverdue && (msgText.includes('ถอน') || (await hasSlipSent(userId) === false && msgText.includes('ไม่เข้า')))) {
    if (withdrawStatus.closed) {
      var closedOverdueMsg = formatWithdrawClosedMsg(withdrawStatus.until, msgText);
      await lineReply(replyToken, txt(closedOverdueMsg));
      await addHistory(userId, 'bot', closedOverdueMsg);
    } else {
      await tgAlert(displayName, 'ถอนเกิน 10 นาที: ' + msgText, ts, userId);
      var overdueMsg2 = 'รับเรื่องแล้วค่ะ \u{1F4CB} น้องนีน่ากำลังดำเนินการให้นะคะ \u23F0';
      await lineReply(replyToken, txt(overdueMsg2));
      await addHistory(userId, 'bot', overdueMsg2);
    }
    return;
  }

  // 3. ของแจก/เครดิตฟรี
  var giveawayWords2 = ['เครดิตฟรี','ของแจก','รับฟรี','แจกเครดิต'];
  if (giveawayWords2.some(function(w) { return msgText.includes(w); })) {
    await lineReply(replyToken, txt(FREE_CREDIT_LINE));
    return;
  }

  // ====== อนุมัติบัญชี / ยืนยันตัวตน ======
  if (isKyc(msgText)) {
    await startWaitingKyc(userId);
    var kycAskMsg = 'รับเรื่องแล้วค่ะ \u{1F4CB}\nขอข้อมูลด้านล่างนี้ด้วยนะคะ\n\n👤 ชื่อ-นามสกุล\n📱 เบอร์โทร\n🏦 เลขบัญชีธนาคาร';
    await lineReply(replyToken, txt(kycAskMsg));
    await addHistory(userId, 'bot', kycAskMsg);
    return;
  }

  // ====== pre-check: "ไม่เข้า" แบบสั้นๆ ======
  var shortNotIn = ['ไม่เข้าล่ะ','ไม่เข้าเลย','ยังไม่เข้า','ไม่เข้าครับ','ไม่เข้าค่ะ','ไม่เข้านะ','เข้าไม่ได้'];
  var isShortNotIn = shortNotIn.some(function(w) { return msgText.includes(w); });
  var hasWithdrawCtx = msgText.includes('ถอน') || msgText.includes('withdraw');

  if (isShortNotIn && !hasWithdrawCtx) {
    if (await isHandled(userId)) {
      await lineReply(replyToken, txt('รับทราบแล้วนะคะ น้องนีน่ากำลังดำเนินการให้อยู่ค่ะ \u23F0'));
      return;
    }
    if (await hasSlipSent(userId)) {
      await setSlipState(userId, { step: 'waiting_info', ts: Date.now() });
      var niMsg = 'ขอเบอร์โทรหรือเลขบัญชีธนาคารด้วยนะคะ \u{1F4CB}';
      await lineReply(replyToken, txt(niMsg));
      await addHistory(userId, 'bot', niMsg);
    } else {
      var askSlipMsg = 'ขอสลิปการโอนเงินมาด้วยนะคะ \u{1F4B8}';
      await lineReply(replyToken, txt(askSlipMsg));
      await setSlipState(userId, { step: 'waiting_confirm', ts: Date.now() });
      await addHistory(userId, 'bot', askSlipMsg);
    }
    return;
  }


  // ====== เกมแตก/แนะนำเกม → สุ่มส่งรูป ======
  var WIN_IMAGES = [
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784230430476_0.jpg',
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784230606391_0.jpg',
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784230866035_0.jpg',
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784231089259_0.jpg',
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784231240243_0.jpg',
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784231491384_0.jpg',
    'https://raw.githubusercontent.com/xlisasakngam-sudo/line-bot-PoNee/main/images/messageImage_1784231589040_0.jpg'
  ];
  var isWinQ = winWords.some(function(w) { return msgText.toLowerCase().includes(w); });
  if (isWinQ) {
    var winUrl = WIN_IMAGES[Math.floor(Math.random() * WIN_IMAGES.length)];
    await lineReply(replyToken, {
      type: 'image',
      originalContentUrl: winUrl,
      previewImageUrl: winUrl,
    });
    return;
  }

  // ====== AI ======
  var history = await getHistory(userId);
  await addHistory(userId, 'user', msgText);

  var aiReply = await aiChat(msgText, history);

  if (aiReply.includes('##REGISTER##')) {
    var regMsg = 'สมัครได้เลยค่ะ \u{1F4DD}\n' + REGISTER_URL;
    await lineReply(replyToken, txt(regMsg));
    await addHistory(userId, 'bot', regMsg);
    return;
  }
  if (aiReply.includes('##CASHBACK##')) {
    var aiLossMsg = '📝เงื่อนไขคืนยอดเสียหน้าเว็บ📝\nสล็อตคืนยอดเสีย 𝟏𝟎%\n-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า-\n(เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ผิดกฎงดถอน)\n\nคาสิโน+ยิงปลา คืนยอดเสีย 𝟓%\n-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า\n-ต้องมียอดเดิมพันอย่างน้อย 𝟓 ไม้ ห้าม 𝐀𝐋𝐋 𝐈𝐍\n\nกดรับยอดเสียได้ทุกวันหลังเวลา 𝟐𝟑.𝟑𝟎น.เป็นต้นไปนะคะ\n\nไปที่เมนูอื่นๆ-รับยอดเสีย';
    await lineReply(replyToken, txt(aiLossMsg));
    await addHistory(userId, 'bot', aiLossMsg.substring(0, 80));
    return;
  }
  if (aiReply.includes('##RESET##')) {
    var aiResetMsg = 'ขอข้อมูลรีรหัสนะคะ \u{1F511}\n\nชื่อที่ใช้สมัคร\nเบอร์โทร\nเลขบัญชีธนาคาร';
    await lineReply(replyToken, txt(aiResetMsg));
    await startWaitingReset(userId);
    await addHistory(userId, 'bot', aiResetMsg);
    return;
  }
  if (aiReply.includes('##ASK_SLIP##')) {
    if (await hasSlipSent(userId)) {
      var alreadyAsk = await redis.get('asked_info:' + userId);
      if (!alreadyAsk) {
        await redis.set('asked_info:' + userId, '1', 'EX', 3600);
        await setSlipState(userId, { step: 'waiting_info', ts: Date.now() });
        var askPhoneMsg = 'ขอเบอร์โทรหรือเลขบัญชีธนาคารด้วยนะคะ น้องแนบสลิปให้เองเลยค่ะ \u{1F495}';
        await lineReply(replyToken, txt(askPhoneMsg));
        await addHistory(userId, 'bot', askPhoneMsg);
      } else {
        await lineReply(replyToken, txt('น้องนีน่ากำลังดำเนินการให้อยู่นะคะ รอสักครู่ค่ะ \u23F0'));
      }
    } else {
      var askSlip = 'ขอสลิปมาด้วยนะคะ \u{1F4B8}';
      await lineReply(replyToken, txt(askSlip));
      await setSlipState(userId, { step: 'waiting_confirm', ts: Date.now() });
      await addHistory(userId, 'bot', askSlip);
    }
    return;
  }
  if (aiReply.includes('##FREE_CREDIT##')) {
    await lineReply(replyToken, txt(FREE_CREDIT_LINE));
    await addHistory(userId, 'bot', FREE_CREDIT_LINE.substring(0, 50));
    return;
  }
  if (aiReply.includes('##ADMIN##') || aiReply.includes('##ADMIN_LINK##')) {
    await tgAlert(displayName, msgText + ' [ต้องการแอดมิน]', ts, userId);
    var adminMsg = 'น้องนีน่ากำลังดำเนินการให้นะคะ \u23F0';
    await lineReply(replyToken, txt(adminMsg));
    await addHistory(userId, 'bot', adminMsg);
    return;
  }

  if (aiReply.includes('##ESCALATE##') || aiReply.toUpperCase().includes('ESCALATE')) {
    var m = msgText.toLowerCase().trim();

    if (m.includes('ทรูมันนี่') || m.includes('truemoney') || m.includes('ทูมันนี่') || m.includes('วอลเลท') || m.includes('wallet') || m.includes('พร้อมเพย์') || m.includes('promptpay')) {
      await lineReply(replyToken, txt('รองรับทุกธนาคารค่ะ\nทรูมันนี่ วอลเลท ฝากขั้นต่ำ 10 บาทนะคะ 💳'));

    } else if (m.includes('ถอน')) {
      if (m.includes('ขั้นต่ำ') || m.includes('เท่าไหร่') || m.includes('เท่าไร') || m.includes('กี่บาท')) {
        await lineReply(replyToken, txt('ถอนขั้นต่ำ 10 บาทนะคะ \u{1F4B8}'));
      } else if (m.includes('นาน') || m.includes('กี่นาที') || m.includes('ใช้เวลา') || m.includes('นานไหม') || m.includes('เร็ว')) {
        await lineReply(replyToken, txt('ปกติถอนภายใน 2-10 นาทีนะคะ \u23F0\nถ้าเกิน 10 นาทีแจ้งน้องได้เลยค่ะ'));
      } else if (m.includes('ไม่เข้า') || m.includes('ไม่ได้') || m.includes('ช้า') || m.includes('ไม่มา')) {
        await lineReply(replyToken, txt('รอ 2-10 นาทีก่อนนะคะ \u23F0\nถ้าเกินแล้วยังไม่เข้าแจ้งน้องได้เลยค่ะ'));
      } else {
        await lineReply(replyToken, txt('ถอนขั้นต่ำ 10 บาท ปกติเงินเข้า 2-10 นาทีนะคะ \u{1F4B8}'));
      }

    } else if (m.includes('ฝาก') || m.includes('เติม') || m.includes('โอนเงิน')) {
      if (m.includes('ขั้นต่ำ') || m.includes('เท่าไหร่') || m.includes('เท่าไร') || m.includes('กี่บาท')) {
        await lineReply(replyToken, txt('ฝากขั้นต่ำ 1 บาทนะคะ \u{1F4B8}'));
      } else if (m.includes('ไม่เข้า') || m.includes('ไม่ได้') || m.includes('หาย')) {
        if (await hasSlipSent(userId)) {
          await lineReply(replyToken, txt('รอสักครู่นะคะ กำลังตรวจสอบให้ \u{1F4CB}'));
        } else {
          var d2 = 'ขอสลิปมาด้วยนะคะ \u{1F4B8}';
          await lineReply(replyToken, txt(d2));
          await setSlipState(userId, { step: 'waiting_confirm', ts: Date.now() });
          await addHistory(userId, 'bot', d2);
        }
      } else {
        await lineReply(replyToken, txt('ฝากขั้นต่ำ 1 บาท โอนแล้วแนบสลิปที่หน้าเว็บได้เลยค่ะ \u{1F4F1}'));
      }

    } else if (m.includes('เทิร์น') || m.includes('turn') || m.includes('ต้องเล่น') || m.includes('เล่นกี่')) {
      await lineReply(replyToken, txt('เล่น 50% ของยอดฝากก่อนถอนนะคะ\nเช่น ฝาก 100 ต้องเล่น 50 แล้วถอนได้เลยค่ะ'));

    } else if (m.includes('แคชแบ็ก') || m.includes('cashback') || m.includes('ยอดเสีย') || m.includes('คืนยอด') || m.includes('โบนัสเสีย')) {
      await lineReply(replyToken, txt('📝เงื่อนไขคืนยอดเสียหน้าเว็บ📝\nสล็อตคืนยอดเสีย 𝟏𝟎%\n-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า-\n(เล่นได้แค่สล็อต ห้ามซื้อฟรีสปิน ผิดกฎงดถอน)\n\nคาสิโน+ยิงปลา คืนยอดเสีย 𝟓%\n-ทำยอด 𝟖 เท่า ถอนได้ 𝟏 เท่า\n-ต้องมียอดเดิมพันอย่างน้อย 𝟓 ไม้ ห้าม 𝐀𝐋𝐋 𝐈𝐍\n\nกดรับยอดเสียได้ทุกวันหลังเวลา 𝟐𝟑.𝟑𝟎น.เป็นต้นไปนะคะ\n\nไปที่เมนูอื่นๆ-รับยอดเสีย'));

    } else if (m.includes('รหัส') || m.includes('password') || m.includes('pass') || m.includes('เข้าไม่ได้') || m.includes('login') || m.includes('ล็อกอิน') || m.includes('เข้าระบบ')) {
      var r2 = 'ขอข้อมูลรีรหัสนะคะ \u{1F511}\n\nชื่อที่ใช้สมัคร\nเบอร์โทร\nเลขบัญชีธนาคาร';
      await lineReply(replyToken, txt(r2));
      await startWaitingReset(userId);
      await addHistory(userId, 'bot', r2);

    } else if (m.includes('สมัคร') || m.includes('ลงทะเบียน') || m.includes('เปิดบัญชี') || m.includes('อยากเล่น') || m.includes('ขอลิงก์')) {
      await lineReply(replyToken, txt('สมัครได้เลยค่ะ \u{1F4DD}\n' + REGISTER_URL));

    } else if (m.includes('โปร') || m.includes('แจก') || m.includes('ฟรี') || m.includes('โบนัส')) {
      await lineReply(replyToken, txt(FREE_CREDIT_LINE));

    } else if ((m.includes('แต้ม') && (m.includes('แลก') || m.includes('สะสม') || m.includes('ใช้'))) || m.includes('loyalty') || m.includes('แลกแต้ม')) {
      await lineReply(replyToken, txt('แลกได้ที่ร้านค้าหน้าเว็บเลยนะคะ 🎯รอติดตามได้เลยค่ะ \u{1F495}'));

    } else if (m.includes('สล็อต') || m.includes('slot') || m.includes('บาคาร่า') || m.includes('เกม') || m.includes('เล่นอะไร')) {
      await lineReply(replyToken, txt('มีสล็อตหลายค่ายเลยค่ะ บาคาร่า คาสิโนสด กีฬา ยิงปลา หวย มีอะไรให้ช่วยไหมคะ 😊'));

    } else if (m.includes('โค้ด') || m.includes('code') || m.includes('คูปอง') || m.includes('coupon')) {
      await lineReply(replyToken, txt('กดที่โลโก้กลางด้านล่างเว็บ แล้วเลือก "ใช้คูปอง" ได้เลยค่ะ \u{1F3AF}'));

    } else if (isSlipAlreadySent(msgText) || m.includes('ส่งแล้ว') || m.includes('ทำแล้ว') || m.includes('แนบแล้ว')) {
      var ni = 'ขอเบอร์โทรหรือเลขบัญชีธนาคารด้วยนะคะ \u{1F4CB}';
      await lineReply(replyToken, txt(ni));
      await setSlipState(userId, { step: 'waiting_info', ts: Date.now() });
      await tgSlipAlert(displayName, '[ยอดไม่เข้า] ' + msgText);
      await addHistory(userId, 'bot', ni);

    } else if (m.includes('สวัสดี') || m.includes('หวัดดี') || m === 'ดี' || m === 'hi' || m === 'hello') {
      await lineReply(replyToken, txt('สวัสดีค่ะ 😊 มีอะไรให้น้องช่วยไหมคะ'));

    } else if (/^5+$/.test(m) || m.includes('ฮ่า') || m.includes('ขำ') || m === '😂') {
      await lineReply(replyToken, txt('😄'));

    } else if (m.includes('น่ารัก') || m.includes('cute') || m.includes('สวย')) {
      await lineReply(replyToken, txt('ขอบคุณค่ะ 😊\u{1F495}'));

    } else if (m.includes('แตก') || m.includes('jackpot') || m.includes('ได้เยอะ') || m.includes('รวย')) {
      await lineReply(replyToken, txt('เย่ๆ ดีใจด้วยนะคะ 🎉'));

    } else if (m.includes('เสีย') || m.includes('หมดแล้ว') || m.includes('เครียด') || m.includes('แย่')) {
      await lineReply(replyToken, txt('เดี๋ยวดีขึ้นนะคะ 💪 มีอะไรให้ช่วยไหมคะ'));

    } else if (m.length <= 20 && ['ดี','โอเค','ok','ขอบคุณ','ได้','เข้าใจ','รับทราบ','เรียบร้อย','ครับ','ค่ะ','จ้า'].some(function(w){ return m.includes(w); })) {
      await lineReply(replyToken, txt('ค่า \u{1F495}'));

    } else {
      await lineReply(replyToken, txt('ค่า \u{1F495}'));
    }
    return;
  }

  if (aiReply.includes('##SPLIT##')) {
    var parts = aiReply.split('##SPLIT##').map(function(p) { return p.trim(); }).filter(Boolean);
    await lineReply(replyToken, parts.map(txt));
    await addHistory(userId, 'bot', parts[0].substring(0, 80));
    return;
  }

  await lineReply(replyToken, txt(aiReply));
  await addHistory(userId, 'bot', aiReply.substring(0, 80));
}

// ==================== TELEGRAM WEBHOOK ====================

app.post('/telegram', async function(req, res) {
  res.sendStatus(200);
  try {
    if (req.body.callback_query) {
      var cb = req.body.callback_query;
      if (cb.data.startsWith('stop:')) {
        var uid = cb.data.split(':')[1];
        await setStop(uid);
        await tgAnswer(cb.id, '\u26D4 หยุดบอทแล้ว!');
        await tgMain('\u26D4 หยุดบอทสำหรับ ' + uid + ' แล้ว (20 นาที)');
      }
      if (cb.data.startsWith('resume:')) {
        var uid2 = cb.data.split(':')[1];
        await clearStop(uid2);
        await tgAnswer(cb.id, '\u25B6\uFE0F เปิดบอทแล้ว!');
        await tgMain('\u25B6\uFE0F เปิดบอทคืนสำหรับ ' + uid2 + ' แล้ว');
      }
      return;
    }

    var msg = req.body.message;
    if (!msg || !msg.text) return;
    var text = msg.text.trim().replace(/@\S+/, '').trim();
    console.log('TG CMD:', text);

    if (text.startsWith('/stop ')) {
      var uid3 = text.split(' ')[1].trim();
      await setStop(uid3);
      await tgMain('\u26D4 หยุดบอทสำหรับ ' + uid3 + ' แล้ว (20 นาที)');
      return;
    }
    if (text.startsWith('/resume ')) {
      var uid4 = text.split(' ')[1].trim();
      await clearStop(uid4);
      await tgMain('\u25B6\uFE0F เปิดบอทคืนสำหรับ ' + uid4 + ' แล้ว');
      return;
    }
    if (text.startsWith('/update ')) {
      var instruction = text.slice(8).trim();
      if (!instruction) { await tgMain('\u274C กรุณาระบุคำสั่ง'); return; }
      await handleUpdate(instruction);
      return;
    }
    if (text === '/status') {
      await tgMain(
        '\u{1F916} <b>น้องนีน่า Status</b>\n\n' +
        '\u2705 Bot: Online\n' +
        '\u{1F9E0} AI: Claude claude-sonnet-4-6\n' +
        '\u{1F4E6} Repo: ' + GITHUB_REPO + '\n\n' +
        '<b>คำสั่ง:</b>\n' +
        '/update [คำสั่ง] — แก้โค้ด+deploy\n' +
        '/stop [userId] — หยุดบอท\n' +
        '/resume [userId] — เปิดบอท\n' +
        '/status — ดูสถานะ'
      );
      return;
    }
  } catch (err) {
    console.error('TG ERROR:', err.message);
    await tgMain('\u274C เกิดข้อผิดพลาด: ' + err.message).catch(function() {});
  }
});

// ==================== LINE WEBHOOK ====================

app.post('/webhook', async function(req, res) {
  var events = req.body.events || [];
  await Promise.all(events.map(handleEvent));
  res.sendStatus(200);
});

app.get('/', function(req, res) {
  res.send('น้องนีน่า Admin Bot |"น้องนีน่า Admin Bot | UFA PRO99 | v1.0"| v3.2');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Server running on port ' + PORT);
  console.log('AI: Claude claude-sonnet-4-6 | UFA PRO99 | v1.0');
});
