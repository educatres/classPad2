import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, set, update } from "firebase/database";

let env;const projectId="classpad-rules-test",classId="class123",studentId="student123",token="abcdefghijklmnopqrstuvwx";
beforeAll(async()=>{env=await initializeTestEnvironment({projectId,database:{rules:fs.readFileSync("database.rules.json","utf8"),host:"127.0.0.1",port:9000}});const now=Date.now(),pages={main:{id:"main",order:0,createdAt:1,createdBy:"teacher"},page_ABCDEF:{id:"page_ABCDEF",order:1,createdAt:2,createdBy:"teacher"}},publicClass={title:"測試",className:"",createdAt:now,expiresAt:now+36000000,updatedAt:now,status:"active",studentCount:1};await env.withSecurityRulesDisabled(async context=>set(ref(context.database()),{classes:{[classId]:{title:"測試",className:"",activityName:"",createdAt:now,expiresAt:now+36000000,updatedAt:now,status:"active",allowStudentWriting:true,allowStudentClear:false,showTeacherAnnotations:true,studentCount:1,admins:{teacher:true},studentOrder:{[studentId]:0},boardPages:pages}},publicClasses:{[classId]:publicClass},students:{[studentId]:{classId,boardToken:token,seatNumber:"01",displayName:"小明",studentUid:"student",enabled:true,locked:false,createdAt:1,updatedAt:1}},boardLookup:{[token]:{classId,studentId}},boardPages:{[token]:pages},boards:{[token]:{meta:{classId,studentId,revision:0,updatedAt:1}}},userClasses:{teacher:{[classId]:true}},teacherKeys:{[classId]:"123456"}}));});
afterAll(()=>env?.cleanup());
const stroke=(uid,color="#112233")=>({id:"stroke_1",tool:"pen",color,width:4,opacity:1,points:[[.1,.1,.5,0],[.2,.2,.5,10]],createdAt:2,authorUid:uid});
const stickyNote=(uid,overrides={})=>({id:"note_1",text:"請看這裡",color:"yellow",x:.1,y:.1,width:.3,height:.2,createdAt:2,updatedAt:2,authorUid:uid,...overrides});
const studentText=(uid,overrides={})=>({text:"這是文字作答",scrollTop:0,layoutVersion:1,updatedAt:2,authorUid:uid,...overrides});

describe("教師指定單一學生切頁的權限", () => {
  const id = "page-request-class", sid = "page-request-student", board = "PageRequestBoardToken1234";
  const request = { id: "request1234567", boardToken: board, pageId: "page_ABCDEF" };
  const studentPath = `students/${sid}`, requestPath = `${studentPath}/pageRequest`;
  let teacher, student, stranger;

  beforeEach(async () => {
    teacher = env.authenticatedContext("page-request-teacher").database();
    student = env.authenticatedContext("page-request-device").database();
    stranger = env.authenticatedContext("page-request-stranger").database();
    const now = Date.now(), pages = {
      main: { id: "main", order: 0, createdAt: now, createdBy: "page-request-teacher" },
      page_ABCDEF: { id: "page_ABCDEF", order: 1, createdAt: now, createdBy: "page-request-teacher" }
    };
    await env.withSecurityRulesDisabled((context) => update(ref(context.database()), {
      [`classes/${id}`]: { title: "切頁測試", createdAt: now, expiresAt: now + 36000000, updatedAt: now, status: "active", allowStudentWriting: true, admins: { "page-request-teacher": true }, studentCount: 1, studentOrder: { [sid]: 0 }, boardPages: pages },
      [studentPath]: { classId: id, boardToken: board, seatNumber: "01", displayName: "學生", studentUid: "page-request-device", enabled: true, locked: false, createdAt: now, updatedAt: now },
      [`boardLookup/${board}`]: { classId: id, studentId: sid }, [`boardPages/${board}`]: pages
    }));
  });

  it("只有本課堂老師可指定頁面，學生只能讀取自己收到的指令", async () => {
    await assertSucceeds(set(ref(teacher, requestPath), request));
    expect((await assertSucceeds(get(ref(student, requestPath)))).val()).toEqual(request);
    await assertFails(get(ref(stranger, requestPath)));
    await assertFails(set(ref(stranger, requestPath), { ...request, pageId: "main" }));
    await assertFails(set(ref(student, requestPath), { ...request, pageId: "main" }));
    await assertFails(set(ref(student, requestPath), null));
    await assertSucceeds(update(ref(teacher, studentPath), { locked: true }));
    await assertSucceeds(set(ref(teacher, requestPath), { ...request, pageId: "main" }));
    expect((await get(ref(student, `${studentPath}/locked`))).val()).toBe(true);
  });

  it("拒絕不存在的頁面、過期白板 Token 與額外欄位", async () => {
    for (const value of [
      { ...request, pageId: "page_NOTFOUND" }, { ...request, boardToken: "OldPageRequestBoard1234" },
      { ...request, id: "" }, { ...request, id: 123 }, { ...request, extra: true },
      { id: request.id, boardToken: board }
    ]) await assertFails(set(ref(teacher, requestPath), value));
  });

  it("首次綁定不能夾帶新指令", async () => {
    await env.withSecurityRulesDisabled((context) => set(ref(context.database(), `${studentPath}/studentUid`), null));
    await assertFails(update(ref(student, studentPath), { studentUid: "page-request-device", pageRequest: request }));
    await assertSucceeds(update(ref(student, studentPath), { studentUid: "page-request-device" }));
  });

  it("首次綁定必須保留老師先前的指令，不能修改或移除", async () => {
    await env.withSecurityRulesDisabled((context) => set(ref(context.database(), `${studentPath}/studentUid`), null));
    await assertSucceeds(set(ref(teacher, requestPath), request));
    for (const value of [null, { ...request, pageId: "main" }, { ...request, id: "changed1234567" }]) {
      await assertFails(update(ref(student, studentPath), { studentUid: "page-request-device", pageRequest: value }));
    }
    const record = (await get(ref(student, studentPath))).val();
    await assertSucceeds(set(ref(student, studentPath), { ...record, studentUid: "page-request-device" }));
    expect((await get(ref(student, requestPath))).val()).toEqual(request);
  });

  it("課程到期後禁止派送指令，老師仍可隨學生資料刪除", async () => {
    await assertSucceeds(set(ref(teacher, requestPath), request));
    await env.withSecurityRulesDisabled((context) => update(ref(context.database(), `classes/${id}`), { createdAt: Date.now() - 36000001, expiresAt: Date.now() - 1 }));
    await assertFails(set(ref(teacher, requestPath), { ...request, pageId: "main" }));
    await assertSucceeds(set(ref(teacher, studentPath), null));
  });
});

describe("十小時期限與關聯資料", () => {
  const ttl = 36_000_000;
  let sequence = 0;
  it.each([
    ["舊三小時", 3, 4, true], ["缺到期欄位", null, 4, true], ["舊長期限", 48, 4, true],
    ["舊三小時", 3, 11, false], ["缺到期欄位", null, 11, false], ["舊長期限", 48, 11, false]
  ])("%s資料（舊期限 %s 小時、已經過 %s 小時）的所有路徑一致", async (_label, storedHours, ageHours, active) => {
    const id = `ttl-linked-${++sequence}`, sid = `ttl-student-${sequence}`, board = `TtlLinkedBoardToken${String(sequence).padStart(6, "0")}`;
    const uid = `ttl-device-${sequence}`, teacherUid = `ttl-teacher-${sequence}`, screenUid = `ttl-screen-${sequence}`, invitedUid = `ttl-invited-${sequence}`, preclaimedUid = `ttl-preclaimed-${sequence}`;
    const display = `TtlDisplay${String(sequence).padStart(14, "0")}`, invite = `TtlInvite${String(sequence).padStart(15, "0")}`, now = Date.now(), createdAt = now - ageHours * 3_600_000;
    const teacher = env.authenticatedContext(teacherUid).database(), student = env.authenticatedContext(uid).database(), screen = env.authenticatedContext(screenUid).database();
    const main = { id: "main", order: 0, createdAt, createdBy: teacherUid }, pageId = "page_TTL123", page = { id: pageId, order: 1, createdAt, createdBy: teacherUid, backgroundImage: { type: "rtdb-capture", classId: id, assetId: pageId, scale: 1, x: .5, y: .5, updatedAt: now, updatedBy: teacherUid } };
    const classroom = { title: "期限連動", className: "", createdAt, updatedAt: now, status: "active", allowStudentWriting: true, allowStudentClear: false, showTeacherAnnotations: true, studentCount: 1, admins: { [teacherUid]: true }, studentOrder: { [sid]: 0 }, displayToken: display, teacherInviteTokens: { [invite]: true }, boardPages: { main, [pageId]: page } };
    if (storedHours !== null) classroom.expiresAt = createdAt + storedHours * 3_600_000;
    const directory = { title: classroom.title, className: "", createdAt, expiresAt: classroom.expiresAt || createdAt + ttl, updatedAt: now, status: "active", studentCount: 1 };
    const asset = { version: 1, mimeType: "image/jpeg", base64: "/9j/2Q==", width: 10, height: 10, byteLength: 4, createdAt: now, createdBy: teacherUid };
    const projection = { classId: id, active: true, studentId: sid, boardToken: board, pageId, label: "期限連動", followStudent: true, updatedAt: now, updatedBy: teacherUid };
    const session = { studentId: sid, boardToken: board };
    await env.withSecurityRulesDisabled((context) => update(ref(context.database()), {
      [`classes/${id}`]: classroom, [`publicClasses/${id}`]: directory,
      [`students/${sid}`]: { classId: id, boardToken: board, seatNumber: "1", displayName: "學生", studentUid: uid, enabled: true, locked: false, createdAt, updatedAt: now },
      [`boardLookup/${board}`]: { classId: id, studentId: sid }, [`boardPages/${board}`]: { main, [pageId]: page },
      [`boards/${board}/meta`]: { classId: id, studentId: sid, revision: 0, updatedAt: now },
      [`boards/${board}/studentStrokes/stroke_1`]: stroke(uid), [`teacherKeys/${id}`]: "123456",
      [`teacherKeyClaims/${id}/${preclaimedUid}`]: "123456", [`userClasses/${teacherUid}/${id}`]: true,
      [`teacherInvites/${invite}`]: { classId: id, createdAt: now, expiresAt: now + 600000, createdBy: teacherUid },
      [`displays/${display}`]: projection, [`classMaterials/${id}/${pageId}`]: asset,
      [`classMaterialSessions/${id}/${uid}`]: session
    }));
    const check = active ? assertSucceeds : assertFails;
    await check(update(ref(teacher, `classes/${id}`), { title: classroom.title }));
    await check(set(ref(teacher, `teacherKeys/${id}`), "123456"));
    await check(set(ref(teacher, `boardLookup/${board}`), { classId: id, studentId: sid }));
    await check(update(ref(teacher, `students/${sid}`), { updatedAt: now }));
    await check(set(ref(teacher, `boardPages/${board}/${pageId}`), page));
    await check(update(ref(student, `boards/${board}/meta`), { revision: 1 }));
    for (const prefix of [`boards/${board}`, `boards/${board}/pages/${pageId}`]) {
      await check(set(ref(student, `${prefix}/studentStrokes/stroke_1`), stroke(uid)));
      await check(set(ref(teacher, `${prefix}/teacherStrokes/stroke_1`), stroke(teacherUid)));
      await check(set(ref(student, `${prefix}/studentText`), studentText(uid)));
      await check(set(ref(teacher, `${prefix}/stickyNotes/note_1`), stickyNote(teacherUid)));
    }
    await check(set(ref(student, `presence/${id}/${sid}`), { uid, online: true, drawing: false, lastSeen: now }));
    await check(set(ref(student, `activeStrokes/${board}/student/${uid}`), { draft: true }));
    await check(set(ref(teacher, `activeStrokes/${board}/teacher/${teacherUid}`), { draft: true }));
    await check(set(ref(teacher, `displays/${display}`), projection));
    await check(set(ref(screen, `displaySessions/${screenUid}`), { displayToken: display, boardToken: board, updatedAt: now }));
    await check(set(ref(student, `classMaterialSessions/${id}/${uid}`), session));
    await check(get(ref(student, `classMaterials/${id}/${pageId}`)));
    await check(set(ref(teacher, `classMaterials/${id}/page_NEWTTL`), asset));
    const newTeacher = env.authenticatedContext(`ttl-key-${sequence}`).database();
    await check(set(ref(newTeacher, `teacherKeyClaims/${id}/ttl-key-${sequence}`), "123456"));
    await check(set(ref(env.authenticatedContext(preclaimedUid).database(), `classes/${id}/admins/${preclaimedUid}`), true));
    const invited = env.authenticatedContext(invitedUid).database();
    await check(set(ref(invited, `teacherInvites/${invite}/claimedBy`), invitedUid));
    if (!active) await env.withSecurityRulesDisabled((context) => set(ref(context.database(), `teacherInvites/${invite}/claimedBy`), invitedUid));
    await check(set(ref(invited, `teacherClaims/${id}/${invitedUid}`), invite));
    if (!active) await env.withSecurityRulesDisabled((context) => set(ref(context.database(), `teacherClaims/${id}/${invitedUid}`), invite));
    await check(set(ref(invited, `classes/${id}/admins/${invitedUid}`), true));

    const canonical = { ...directory, expiresAt: createdAt + ttl };
    // Both deadline fields migrate together, without changing the original creation time or boards.
    await check(update(ref(teacher), { [`classes/${id}/expiresAt`]: createdAt + ttl, [`publicClasses/${id}`]: canonical }));
    if (active) {
      await assertFails(set(ref(teacher, `classes/${id}/expiresAt`), createdAt + ttl + 1));
      await assertFails(set(ref(teacher, `classes/${id}/createdAt`), now));
      await assertFails(set(ref(teacher, `classes/${id}/createdAt`), null));
      expect((await get(ref(teacher, `classes/${id}/createdAt`))).val()).toBe(createdAt);
      expect((await get(ref(teacher, `publicClasses/${id}/expiresAt`))).val()).toBe(createdAt + ttl);
      expect((await get(ref(student, `boards/${board}/studentStrokes/stroke_1`))).val().points).toEqual(stroke(uid).points);
    } else {
      const paths = [`classes/${id}`, `publicClasses/${id}`, `students/${sid}`, `boardLookup/${board}`, `boardPages/${board}`, `boards/${board}`, `activeStrokes/${board}`, `presence/${id}`, `teacherKeys/${id}`, `teacherKeyClaims/${id}`, `teacherClaims/${id}`, `teacherSlots/${id}`, `teacherInvites/${invite}`, `displays/${display}`, `classMaterials/${id}`, `classMaterialSessions/${id}`, `userClasses/${teacherUid}/${id}`];
      await assertSucceeds(update(ref(teacher), Object.fromEntries(paths.map((path) => [path, null]))));
      await env.withSecurityRulesDisabled(async (context) => {
        for (const path of paths) expect((await get(ref(context.database(), path))).exists()).toBe(false);
      });
    }
  });
});

describe("PDF 截圖教材權限", () => {
  let capClass, capStudent, capBoard, teacher, studentDb, stranger, now;
  const assetId = "page_CAPTURE123", otherId = "page_CAPTURE456", displayToken = "CAPTUREabcdefgh234567890";
  let asset, page;
  let counter = 0;
  beforeEach(async () => {
    capClass = `capture-class-${++counter}`; capStudent = `capture-student-${counter}`; capBoard = `CaptureBoardToken${String(counter).padStart(8, "0")}`; now = Date.now();
    teacher = env.authenticatedContext("capture-teacher").database(); studentDb = env.authenticatedContext("capture-student").database(); stranger = env.authenticatedContext("capture-stranger").database();
    asset = { version: 1, mimeType: "image/jpeg", base64: "/9j/2Q==", width: 10, height: 10, byteLength: 4, createdAt: now, createdBy: "capture-teacher" };
    page = { id: assetId, order: 1, createdAt: now, createdBy: "capture-teacher", backgroundImage: { type: "rtdb-capture", classId: capClass, assetId, scale: 1, x: .5, y: .5, updatedAt: now, updatedBy: "capture-teacher" } };
    const main = { id: "main", order: 0, createdAt: now, createdBy: "capture-teacher" };
    await env.withSecurityRulesDisabled((context) => update(ref(context.database()), {
      [`classes/${capClass}`]: { title: "教材測試", createdAt: now, expiresAt: now + 36000000, updatedAt: now, status: "active", admins: { "capture-teacher": true }, studentOrder: { [capStudent]: 0 }, boardPages: { main } },
      [`students/${capStudent}`]: { classId: capClass, boardToken: capBoard, studentUid: "capture-student", enabled: true, locked: false, seatNumber: "1", displayName: "學生", createdAt: now, updatedAt: now },
      [`boardLookup/${capBoard}`]: { classId: capClass, studentId: capStudent },
      [`boardPages/${capBoard}`]: { main }
    }));
  });
  const send = () => assertSucceeds(update(ref(teacher), {
    [`classMaterials/${capClass}/${assetId}`]: asset,
    [`classes/${capClass}/boardPages/${assetId}`]: page,
    [`boardPages/${capBoard}/${assetId}`]: page,
    [`classes/${capClass}/updatedAt`]: now
  }));
  const bindSession = () => set(ref(studentDb, `classMaterialSessions/${capClass}/capture-student`), { studentId: capStudent, boardToken: capBoard });
  it("首次原子派送成功，只有老師及有效綁定且有該頁參照的學生可讀單張", async () => {
    await send(); await assertSucceeds(bindSession());
    await assertSucceeds(get(ref(teacher, `classMaterials/${capClass}/${assetId}`)));
    await assertSucceeds(get(ref(studentDb, `classMaterials/${capClass}/${assetId}`)));
    await assertFails(get(ref(stranger, `classMaterials/${capClass}/${assetId}`)));
    await assertFails(get(ref(env.authenticatedContext("teacher").database(), `classMaterials/${capClass}/${assetId}`)));
    await assertFails(get(ref(studentDb, `classMaterials/${capClass}`)));
    await assertFails(get(ref(teacher, `classMaterials/${capClass}`)));
    await assertFails(set(ref(studentDb, `classMaterials/${capClass}/${otherId}`), { ...asset, createdBy: "capture-student" }));
    await assertSucceeds(set(ref(teacher, `classMaterials/${capClass}/${otherId}`), asset));
    await assertFails(get(ref(studentDb, `classMaterials/${capClass}/${otherId}`)));
  });
  it("拒絕偽造 session、他人 session 與額外欄位，只能刪自己的 session", async () => {
    const session = { studentId: capStudent, boardToken: capBoard };
    await assertFails(set(ref(stranger, `classMaterialSessions/${capClass}/capture-stranger`), session));
    await assertFails(set(ref(studentDb, `classMaterialSessions/${capClass}/someone-else`), session));
    await assertFails(set(ref(studentDb, `classMaterialSessions/${capClass}/capture-student`), { ...session, extra: true }));
    await assertSucceeds(bindSession());
    await assertFails(get(ref(stranger, `classMaterialSessions/${capClass}/capture-student`)));
    await assertFails(get(ref(studentDb, `classMaterialSessions/${capClass}`)));
    await assertSucceeds(set(ref(studentDb, `classMaterialSessions/${capClass}/capture-student`), null));
  });
  it("解除綁定、停用、換 token 或跨班後舊 session 立刻失去教材權限", async () => {
    await send(); await bindSession();
    for (const changes of [{ studentUid: null }, { enabled: false }, { boardToken: "NewCaptureBoardToken123456" }, { classId: "another-class" }]) {
      await env.withSecurityRulesDisabled((context) => update(ref(context.database(), `students/${capStudent}`), changes));
      await assertFails(get(ref(studentDb, `classMaterials/${capClass}/${assetId}`)));
      await assertFails(bindSession());
      await env.withSecurityRulesDisabled((context) => update(ref(context.database(), `students/${capStudent}`), { studentUid: "capture-student", enabled: true, boardToken: capBoard, classId: capClass }));
    }
    await env.withSecurityRulesDisabled((context) => set(ref(context.database(), `boardLookup/${capBoard}`), null));
    await assertFails(get(ref(studentDb, `classMaterials/${capClass}/${assetId}`)));
  });
  it("拒絕跨班參照、錯誤 assetId、main 及任意 Data URL", async () => {
    for (const background of [{ ...page.backgroundImage, classId: "other-class" }, { ...page.backgroundImage, assetId: otherId }, { ...page.backgroundImage, sourceUrl: "data:image/jpeg;base64,AAAA" }]) {
      await assertFails(set(ref(teacher, `classes/${capClass}/boardPages/${assetId}`), { ...page, backgroundImage: background }));
      await assertFails(set(ref(teacher, `boardPages/${capBoard}/${assetId}`), { ...page, backgroundImage: background }));
    }
    await assertFails(set(ref(teacher, `classes/${capClass}/boardPages/main/backgroundImage`), page.backgroundImage));
  });
  it("限制 MIME、Base64、大小、整數尺寸、作者、時間及未知欄位", async () => {
    for (const fields of [{ mimeType: "image/png" }, { base64: "data:AAAA" }, { base64: "AA=A" }, { base64: "A".repeat(349532) }, { width: 1601 }, { height: 1.5 }, { byteLength: 262145 }, { byteLength: 0 }, { createdBy: "someone" }, { createdAt: now + 120000 }, { filename: "private.pdf" }, { version: 2 }]) await assertFails(set(ref(teacher, `classMaterials/${capClass}/${assetId}`), { ...asset, ...fields }));
    await assertSucceeds(set(ref(teacher, `classMaterials/${capClass}/${assetId}`), { ...asset, width: 1600, byteLength: 262144, base64: "A".repeat(349526) + "==" }));
  });
  it("派送後固定教材圖片及版面，不能逐欄修改或從父層覆蓋", async () => {
    await send();
    await assertFails(update(ref(teacher, `classMaterials/${capClass}/${assetId}`), { width: 20 }));
    await assertFails(set(ref(teacher, `classMaterials/${capClass}`), { [assetId]: { ...asset, createdBy: "other" } }));
    await assertFails(set(ref(teacher, `classMaterials/${capClass}`), { [assetId]: { ...asset, base64: "AAAA" } }));
    for (const path of [`classes/${capClass}/boardPages/${assetId}/backgroundImage`, `boardPages/${capBoard}/${assetId}/backgroundImage`]) {
      for (const changes of [{ scale: .8 }, { x: .3 }, { y: .4 }]) await assertFails(update(ref(teacher, path), changes));
    }
    await assertFails(set(ref(teacher, `classes/${capClass}/boardPages/${assetId}/backgroundImage`), { sourceUrl: "https://drive.google.com/a", imageUrl: "https://drive.google.com/thumbnail?id=abcdefghij&sz=w2000", scale: 1, updatedAt: now, updatedBy: "capture-teacher" }));
  });
  it("展示僅可讀取合法目前投影頁，切頁及取消投影立即撤權", async () => {
    await send(); const screen = env.authenticatedContext("capture-screen").database();
    await env.withSecurityRulesDisabled((context) => update(ref(context.database()), {
      [`classes/${capClass}/displayToken`]: displayToken,
      [`displays/${displayToken}`]: { classId: capClass, active: true, boardToken: capBoard, studentId: capStudent, pageId: assetId, label: "題目", followStudent: true, updatedAt: now, updatedBy: "capture-teacher" }
    }));
    await assertSucceeds(set(ref(screen, "displaySessions/capture-screen"), { displayToken, boardToken: capBoard, updatedAt: now }));
    await assertSucceeds(get(ref(screen, `classMaterials/${capClass}/${assetId}`)));
    await assertSucceeds(update(ref(teacher, `displays/${displayToken}`), { pageId: "main" }));
    await assertFails(get(ref(screen, `classMaterials/${capClass}/${assetId}`)));
    await assertSucceeds(update(ref(teacher, `displays/${displayToken}`), { pageId: assetId, active: false }));
    await assertFails(get(ref(screen, `classMaterials/${capClass}/${assetId}`)));
    await assertFails(set(ref(screen, `classMaterials/${capClass}/${assetId}`), asset));
  });
  it("關閉或到期禁止派送，到期學生不可讀，但老師可原子清除整班教材與 sessions", async () => {
    await send(); await bindSession();
    await assertSucceeds(update(ref(teacher, `classes/${capClass}`), { status: "closed" }));
    await assertFails(set(ref(teacher, `classMaterials/${capClass}/${otherId}`), asset));
    await env.withSecurityRulesDisabled((context) => update(ref(context.database(), `classes/${capClass}`), { createdAt: now - 36000001, expiresAt: now - 1 }));
    await assertFails(get(ref(studentDb, `classMaterials/${capClass}/${assetId}`)));
    await assertFails(bindSession());
    await assertFails(set(ref(teacher, `classMaterials/${capClass}/${otherId}`), asset));
    await assertSucceeds(update(ref(teacher), { [`classes/${capClass}`]: null, [`classMaterials/${capClass}`]: null, [`classMaterialSessions/${capClass}`]: null, [`students/${capStudent}`]: null, [`boardPages/${capBoard}`]: null, [`boardLookup/${capBoard}`]: null }));
    await env.withSecurityRulesDisabled(async (context) => { expect((await get(ref(context.database(), `classMaterials/${capClass}`))).exists()).toBe(false); });
  });
});
describe("Realtime Database 權限",()=>{
  it("所有已登入使用者可讀精簡課程目錄且只有老師可同步",async()=>{const teacherDb=env.authenticatedContext("teacher").database(),otherDb=env.authenticatedContext("other-directory-reader").database(),unauthenticatedDb=env.unauthenticatedContext().database(),path=`publicClasses/${classId}`;await assertSucceeds(get(ref(otherDb,"publicClasses")));await assertFails(get(ref(unauthenticatedDb,"publicClasses")));await assertFails(update(ref(otherDb,path),{status:"closed"}));await assertFails(update(ref(teacherDb,path),{title:"偽造名稱"}));await assertFails(update(ref(teacherDb,path),{privateData:"不可公開"}));const classroom=(await get(ref(teacherDb,`classes/${classId}`))).val();await assertSucceeds(set(ref(teacherDb,path),{title:classroom.title,className:classroom.className,createdAt:classroom.createdAt,expiresAt:classroom.expiresAt,updatedAt:classroom.updatedAt,status:classroom.status,studentCount:classroom.studentCount}));});
  it("新課程只能設定為建立後 10 小時到期",async()=>{const db=env.authenticatedContext("new-class-teacher").database(),now=Date.now(),base={title:"十小時課堂",className:"",activityName:"",createdAt:now,updatedAt:now,status:"active",allowStudentWriting:true,allowStudentClear:false,showTeacherAnnotations:true,studentCount:0,admins:{"new-class-teacher":true}};await assertSucceeds(set(ref(db,"classes/ten-hour-class"),{...base,expiresAt:now+36_000_000}));await assertFails(set(ref(db,"classes/three-hour-class"),{...base,expiresAt:now+10_800_000}));await assertFails(set(ref(db,"classes/twelve-hour-class"),{...base,expiresAt:now+43_200_000}));});
  it("老師可讀課堂與寫批注",async()=>{const db=env.authenticatedContext("teacher").database();await assertSucceeds(get(ref(db,`classes/${classId}`)));await assertSucceeds(set(ref(db,`boards/${token}/teacherStrokes/stroke_1`),stroke("teacher")));});
  it("老師批注只接受布林值的平滑設定",async()=>{const db=env.authenticatedContext("teacher").database();await assertSucceeds(set(ref(db,`boards/${token}/teacherStrokes/stroke_1`),{...stroke("teacher"),smooth:true}));await assertFails(set(ref(db,`boards/${token}/teacherStrokes/stroke_1`),{...stroke("teacher"),smooth:"true"}));});
  it("老師可管理便條貼，學生只能讀取",async()=>{const teacherDb=env.authenticatedContext("teacher").database(),studentDb=env.authenticatedContext("student").database();await assertSucceeds(set(ref(teacherDb,`boards/${token}/stickyNotes/note_1`),stickyNote("teacher")));await assertSucceeds(get(ref(studentDb,`boards/${token}/stickyNotes/note_1`)));await assertFails(update(ref(studentDb,`boards/${token}/stickyNotes/note_1`),{x:.2}));await assertSucceeds(update(ref(teacherDb,`boards/${token}/stickyNotes/note_1`),{x:.2,updatedAt:3}));await assertSucceeds(set(ref(teacherDb,`boards/${token}/stickyNotes/note_1`),null));});
  it("拒絕超出白板或使用未知顏色的便條貼",async()=>{const db=env.authenticatedContext("teacher").database();await assertFails(set(ref(db,`boards/${token}/stickyNotes/note_1`),stickyNote("teacher",{x:.9,width:.3})));await assertFails(set(ref(db,`boards/${token}/stickyNotes/note_1`),stickyNote("teacher",{color:"purple"})));});
  it("學生可寫自己的筆跡且不能寫老師圖層",async()=>{const db=env.authenticatedContext("student").database();await assertSucceeds(set(ref(db,`boards/${token}/studentStrokes/stroke_1`),stroke("student")));await assertFails(set(ref(db,`boards/${token}/teacherStrokes/stroke_2`),{...stroke("student"),id:"stroke_2"}));});
  it("學生可編輯純文字圖層，老師只能讀取或清除",async()=>{const studentDb=env.authenticatedContext("student").database(),teacherDb=env.authenticatedContext("teacher").database(),otherDb=env.authenticatedContext("other-text").database();await assertSucceeds(set(ref(studentDb,`boards/${token}/studentText`),studentText("student")));await assertSucceeds(get(ref(teacherDb,`boards/${token}/studentText`)));await assertFails(set(ref(teacherDb,`boards/${token}/studentText`),studentText("teacher")));await assertFails(get(ref(otherDb,`boards/${token}/studentText`)));await assertSucceeds(set(ref(teacherDb,`boards/${token}/studentText`),null));});
  it("文字圖層限制字數、排版版本與捲動位置",async()=>{const db=env.authenticatedContext("student").database();await assertFails(set(ref(db,`boards/${token}/studentText`),studentText("student",{text:"x".repeat(5001)})));await assertFails(set(ref(db,`boards/${token}/studentText`),studentText("student",{layoutVersion:2})));await assertFails(set(ref(db,`boards/${token}/studentText`),studentText("student",{scrollTop:-1})));});
  it("老師與學生可更新最後書寫頁，並拒絕不存在的頁面",async()=>{const teacherDb=env.authenticatedContext("teacher").database(),studentDb=env.authenticatedContext("student").database();await assertSucceeds(update(ref(studentDb,`boards/${token}/meta`),{lastWrittenPageId:"main",lastWrittenAt:10,lastWrittenLayer:"studentStrokes",updatedAt:10,revision:10}));await assertSucceeds(update(ref(teacherDb,`boards/${token}/meta`),{lastWrittenPageId:"page_ABCDEF",lastWrittenAt:20,lastWrittenLayer:"teacherStrokes",updatedAt:20,revision:20}));await assertFails(update(ref(teacherDb,`boards/${token}/meta`),{lastWrittenPageId:"page_NOTFOUND",lastWrittenAt:30,lastWrittenLayer:"teacherStrokes",updatedAt:30,revision:30}));});
  it("新學生只用專屬網址即可完成首次綁定並開啟白板",async()=>{const freshStudent="fresh-student",freshToken="ZYXWVUTSzyxwvuts87654321",uid="fresh-device",db=env.authenticatedContext(uid).database(),pages={main:{id:"main",order:0,createdAt:1,createdBy:"teacher"}},student={classId,boardToken:freshToken,seatNumber:"02",displayName:"新學生",enabled:true,locked:false,createdAt:1,updatedAt:1};await env.withSecurityRulesDisabled(async context=>update(ref(context.database()),{[`students/${freshStudent}`]:student,[`boardLookup/${freshToken}`]:{classId,studentId:freshStudent},[`boardPages/${freshToken}`]:pages,[`boards/${freshToken}/meta`]:{classId,studentId:freshStudent,revision:0,updatedAt:1}}));await assertSucceeds(get(ref(db,`boardLookup/${freshToken}`)));await assertSucceeds(get(ref(db,`students/${freshStudent}`)));await assertSucceeds(set(ref(db,`students/${freshStudent}`),{...student,studentUid:uid,updatedAt:2}));await assertSucceeds(get(ref(db,`boardPages/${freshToken}`)));await assertSucceeds(get(ref(db,`boards/${freshToken}/studentStrokes`)));await assertSucceeds(set(ref(db,`presence/${classId}/${freshStudent}`),{uid,online:true,drawing:false,currentPageId:"main",lastSeen:2}));});
  it("老師可建立共用頁序，學生只能讀取",async()=>{const teacherDb=env.authenticatedContext("teacher").database(),studentDb=env.authenticatedContext("student").database(),pages={main:{id:"main",order:0,createdAt:1,createdBy:"teacher"},page_ABCDEF:{id:"page_ABCDEF",order:1,createdAt:2,createdBy:"teacher"}};await assertSucceeds(update(ref(teacherDb),{[`classes/${classId}/boardPages`]:pages,[`boardPages/${token}`]:pages}));await assertSucceeds(get(ref(studentDb,`boardPages/${token}`)));await assertFails(set(ref(studentDb,`boardPages/${token}/page_GHIJKL`),{id:"page_GHIJKL",order:2,createdAt:3,createdBy:"student"}));});
  it("老師與學生皆不能新增 Drive 底圖或同步外部圖片網址", async () => {
    const teacherDb = env.authenticatedContext("teacher").database(), studentDb = env.authenticatedContext("student").database();
    const background = { sourceUrl: "https://drive.google.com/file/d/1234567890abcdef/view", imageUrl: "https://drive.google.com/thumbnail?id=1234567890abcdef&sz=w2000", scale: 1, x: .5, y: .5, updatedAt: 3, updatedBy: "teacher" };
    for (const pageId of ["main", "page_ABCDEF"]) {
      await assertFails(set(ref(teacherDb, `classes/${classId}/boardPages/${pageId}/backgroundImage`), background));
      await assertFails(set(ref(teacherDb, `boardPages/${token}/${pageId}/backgroundImage`), background));
      await assertFails(set(ref(studentDb, `boardPages/${token}/${pageId}/backgroundImage`), background));
    }
  });
  it("學生可寫自己的新增頁，但不能寫老師圖層",async()=>{const db=env.authenticatedContext("student").database();await assertSucceeds(set(ref(db,`boards/${token}/pages/page_ABCDEF/studentStrokes/stroke_1`),stroke("student")));await assertFails(set(ref(db,`boards/${token}/pages/page_ABCDEF/teacherStrokes/stroke_2`),{...stroke("student"),id:"stroke_2"}));});
  it("學生可在新增頁使用文字圖層",async()=>{const db=env.authenticatedContext("student").database();await assertSucceeds(set(ref(db,`boards/${token}/pages/page_ABCDEF/studentText`),studentText("student")));await assertSucceeds(get(ref(db,`boards/${token}/pages/page_ABCDEF/studentText`)));});
  it("學生 presence 只能使用存在的頁碼",async()=>{const db=env.authenticatedContext("student").database(),base={uid:"student",online:true,drawing:false,lastSeen:3};await assertSucceeds(set(ref(db,`presence/${classId}/${studentId}`),{...base,currentPageId:"page_ABCDEF",lastWrittenPageId:"main"}));await assertFails(set(ref(db,`presence/${classId}/${studentId}`),{...base,currentPageId:"page_NOTFOUND"}));});
  it("展示裝置不限數量，且只能被動讀取老師目前投影的學生與頁面",async()=>{const displayToken="RSTUVWXYZabcdefghjkmnpqr",teacherDb=env.authenticatedContext("teacher").database(),displayDb=env.authenticatedContext("display-screen").database(),secondDisplayDb=env.authenticatedContext("display-screen-2").database();await assertSucceeds(set(ref(teacherDb,`classes/${classId}/displayToken`),displayToken));await assertSucceeds(set(ref(teacherDb,`displays/${displayToken}`),{classId,active:false,updatedAt:4,updatedBy:"teacher"}));await assertFails(set(ref(displayDb,"displaySessions/display-screen"),{displayToken,boardToken:token,updatedAt:4}));await assertSucceeds(set(ref(teacherDb,`displays/${displayToken}`),{classId,active:true,studentId,boardToken:token,pageId:"main",label:"01 小明",followStudent:true,updatedAt:5,updatedBy:"teacher"}));await assertSucceeds(set(ref(displayDb,"displaySessions/display-screen"),{displayToken,boardToken:token,updatedAt:5}));await assertSucceeds(set(ref(secondDisplayDb,"displaySessions/display-screen-2"),{displayToken,boardToken:token,updatedAt:5}));await assertSucceeds(get(ref(displayDb,`boards/${token}/studentStrokes`)));await assertSucceeds(get(ref(secondDisplayDb,`boards/${token}/studentStrokes`)));await assertFails(get(ref(displayDb,`boards/${token}/pages/page_ABCDEF/studentStrokes`)));await assertSucceeds(get(ref(displayDb,`boardPages/${token}`)));await assertFails(set(ref(displayDb,`boards/${token}/studentStrokes/display_stroke`),{...stroke("display-screen"),id:"display_stroke"}));await assertFails(get(ref(displayDb,"boards/not-the-selected-board/studentStrokes")));await assertSucceeds(update(ref(teacherDb,`displays/${displayToken}`),{pageId:"page_ABCDEF",updatedAt:6}));await assertSucceeds(get(ref(displayDb,`boards/${token}/pages/page_ABCDEF/studentStrokes`)));await assertSucceeds(get(ref(secondDisplayDb,`boards/${token}/pages/page_ABCDEF/studentStrokes`)));await assertFails(get(ref(displayDb,`boards/${token}/studentStrokes`)));await assertSucceeds(set(ref(teacherDb,`displays/${displayToken}`),{classId,active:false,updatedAt:7,updatedBy:"teacher"}));await assertFails(get(ref(displayDb,`boards/${token}/pages/page_ABCDEF/studentStrokes`)));await assertFails(get(ref(secondDisplayDb,`boards/${token}/pages/page_ABCDEF/studentStrokes`)));await assertSucceeds(set(ref(displayDb,"displaySessions/display-screen"),null));await assertSucceeds(set(ref(secondDisplayDb,"displaySessions/display-screen-2"),null));});
  it("學生不能修改姓名或把自己加入管理員",async()=>{const db=env.authenticatedContext("student").database();await assertFails(update(ref(db,`students/${studentId}`),{displayName:"惡意修改"}));await assertFails(set(ref(db,`classes/${classId}/admins/student`),true));});
  it("其他人不能讀學生資料或筆跡",async()=>{const db=env.authenticatedContext("other").database();await assertFails(get(ref(db,`students/${studentId}`)));await assertFails(get(ref(db,`boards/${token}/studentStrokes`)));});
  it("拒絕非法顏色與未登入存取",async()=>{const db=env.authenticatedContext("student").database();await assertFails(set(ref(db,`boards/${token}/studentStrokes/stroke_1`),stroke("student","red")));await assertFails(get(ref(env.unauthenticatedContext().database(),`boardLookup/${token}`)));});
  it("學生人數與順序上限為 80",async()=>{const db=env.authenticatedContext("teacher").database();await assertSucceeds(set(ref(db,`classes/${classId}/studentCount`),80));await assertFails(set(ref(db,`classes/${classId}/studentCount`),81));await assertSucceeds(set(ref(db,`classes/${classId}/studentOrder/student080`),79));await assertFails(set(ref(db,`classes/${classId}/studentOrder/student081`),80));});
  it("只有老師可釘選本課堂學生",async()=>{const teacherDb=env.authenticatedContext("teacher").database(),studentDb=env.authenticatedContext("student").database();await assertSucceeds(set(ref(teacherDb,`classes/${classId}/pinnedStudents/${studentId}`),true));await assertFails(set(ref(studentDb,`classes/${classId}/pinnedStudents/${studentId}`),true));await assertFails(set(ref(teacherDb,`classes/${classId}/pinnedStudents/not-in-class`),true));await assertSucceeds(set(ref(teacherDb,`classes/${classId}/pinnedStudents/${studentId}`),null));});
  it("新裝置可用短效單次連結取得老師權限",async()=>{const inviteToken="ABCDEFGHJKLMNPQRSTUVWX23",now=Date.now(),teacherDb=env.authenticatedContext("teacher").database(),monitorDb=env.authenticatedContext("monitor").database();await assertSucceeds(update(ref(teacherDb),{[`teacherInvites/${inviteToken}`]:{classId,createdBy:"teacher",createdAt:now,expiresAt:now+600000},[`classes/${classId}/teacherInviteTokens/${inviteToken}`]:true}));await assertSucceeds(set(ref(monitorDb,`teacherInvites/${inviteToken}/claimedBy`),"monitor"));await assertSucceeds(set(ref(monitorDb,`teacherClaims/${classId}/monitor`),inviteToken));await assertSucceeds(set(ref(monitorDb,`classes/${classId}/admins/monitor`),true));await assertSucceeds(set(ref(monitorDb,`userClasses/monitor/${classId}`),true));await assertSucceeds(get(ref(monitorDb,`classes/${classId}`)));await assertSucceeds(update(ref(monitorDb),{[`teacherClaims/${classId}/monitor`]:null,[`teacherInvites/${inviteToken}`]:null,[`classes/${classId}/teacherInviteTokens/${inviteToken}`]:null}));});
  it("永久老師連結可用六位數密鑰授權多台相同權限裝置",async()=>{
    const keyClass="class-key-access",key="012345",now=Date.now(),teacherDb=env.authenticatedContext("key-teacher").database(),firstDb=env.authenticatedContext("key-monitor-1").database(),secondDb=env.authenticatedContext("key-monitor-2").database();
    await env.withSecurityRulesDisabled(async context=>update(ref(context.database()),{
      [`classes/${keyClass}`]:{title:"密鑰課堂",className:"",activityName:"",createdAt:now,expiresAt:now+36000000,updatedAt:now,status:"active",allowStudentWriting:true,allowStudentClear:false,showTeacherAnnotations:true,studentCount:0,admins:{"key-teacher":true}},
      [`userClasses/key-teacher/${keyClass}`]:true,
      [`teacherKeys/${keyClass}`]:key
    }));
    await assertSucceeds(get(ref(teacherDb,`teacherKeys/${keyClass}`)));
    await assertFails(get(ref(firstDb,`teacherKeys/${keyClass}`)));
    await assertFails(set(ref(firstDb,`teacherKeyClaims/${keyClass}/key-monitor-1`),"999999"));
    await assertSucceeds(set(ref(firstDb,`teacherKeyClaims/${keyClass}/key-monitor-1`),key));
    await assertSucceeds(set(ref(firstDb,`classes/${keyClass}/admins/key-monitor-1`),true));
    await assertSucceeds(set(ref(firstDb,`userClasses/key-monitor-1/${keyClass}`),true));
    await assertSucceeds(set(ref(firstDb,`teacherKeyClaims/${keyClass}/key-monitor-1`),null));
    await assertSucceeds(set(ref(secondDb,`teacherKeyClaims/${keyClass}/key-monitor-2`),key));
    await assertSucceeds(set(ref(secondDb,`classes/${keyClass}/admins/key-monitor-2`),true));
    await assertSucceeds(set(ref(secondDb,`userClasses/key-monitor-2/${keyClass}`),true));
    await assertSucceeds(update(ref(firstDb,`classes/${keyClass}`),{activityName:"第一台管理",updatedAt:2}));
    await assertSucceeds(update(ref(secondDb,`classes/${keyClass}`),{activityName:"第二台管理",updatedAt:3}));
    const addedStudent="key-added-student",addedBoard="ABCDEFGHabcdefgh23456789",pages={main:{id:"main",order:0,createdAt:1,createdBy:"key-teacher"}};
    await assertSucceeds(set(ref(secondDb,`boardLookup/${addedBoard}`),{studentId:addedStudent,classId:keyClass}));
    await assertSucceeds(update(ref(secondDb),{
      [`students/${addedStudent}`]:{classId:keyClass,boardToken:addedBoard,seatNumber:"01",displayName:"密鑰新增學生",studentUid:null,enabled:true,locked:false,createdAt:4,updatedAt:4},
      [`classes/${keyClass}/studentOrder/${addedStudent}`]:0,
      [`classes/${keyClass}/studentCount`]:1,
      [`classes/${keyClass}/updatedAt`]:4,
      [`boards/${addedBoard}/meta`]:{classId:keyClass,studentId:addedStudent,revision:0,updatedAt:4},
      [`boardPages/${addedBoard}`]:pages
    }));
    await assertSucceeds(update(ref(secondDb),{
      [`classes/${keyClass}`]:null,
      [`userClasses/key-teacher/${keyClass}`]:null,
      [`userClasses/key-monitor-1/${keyClass}`]:null,
      [`userClasses/key-monitor-2/${keyClass}`]:null,
      [`teacherSlots/${keyClass}`]:null,
      [`teacherKeys/${keyClass}`]:null,
      [`teacherKeyClaims/${keyClass}`]:null,
      [`students/${addedStudent}`]:null,
      [`boardLookup/${addedBoard}`]:null,
      [`boards/${addedBoard}`]:null,
      [`boardPages/${addedBoard}`]:null
    }));
  });
  it("同一課堂所有已授權老師享有相同權限",async()=>{
    const sharedClass="class-shared-rights",sharedStudent="student-shared-rights",sharedBoard="23456789abcdefghjkmnpqrs",displayToken="23456789ABCDEFGHJKLMNPQR",inviteToken="ABCDEFGHJKLMNPQRSTUVWX29",now=Date.now(),peerUid="shared-monitor",peerDb=env.authenticatedContext(peerUid).database();
    const pages={main:{id:"main",order:0,createdAt:1,createdBy:"shared-teacher"}};
    await env.withSecurityRulesDisabled(async context=>update(ref(context.database()),{
      [`classes/${sharedClass}`]:{title:"同權限課堂",className:"",activityName:"",createdAt:now,expiresAt:now+36000000,updatedAt:now,status:"active",allowStudentWriting:true,allowStudentClear:false,showTeacherAnnotations:true,studentCount:1,displayToken,admins:{"shared-teacher":true,[peerUid]:true},studentOrder:{[sharedStudent]:0},boardPages:pages},
      [`students/${sharedStudent}`]:{classId:sharedClass,boardToken:sharedBoard,seatNumber:"01",displayName:"同學",enabled:true,locked:false,createdAt:1,updatedAt:1},
      [`boardLookup/${sharedBoard}`]:{classId:sharedClass,studentId:sharedStudent},
      [`boardPages/${sharedBoard}`]:pages,
      [`boards/${sharedBoard}/meta`]:{classId:sharedClass,studentId:sharedStudent,revision:0,updatedAt:1},
      [`userClasses/shared-teacher/${sharedClass}`]:true,
      [`userClasses/${peerUid}/${sharedClass}`]:true,
      [`displays/${displayToken}`]:{classId:sharedClass,active:false,updatedAt:1,updatedBy:"shared-teacher"}
    }));
    await assertSucceeds(get(ref(peerDb,`classes/${sharedClass}`)));
    await assertSucceeds(get(ref(peerDb,`userClasses/${peerUid}/${sharedClass}`)));
    await assertSucceeds(update(ref(peerDb,`classes/${sharedClass}`),{activityName:"由監看裝置更新",updatedAt:now}));
    await assertSucceeds(update(ref(peerDb,`students/${sharedStudent}`),{locked:true,updatedAt:now}));
    await assertSucceeds(set(ref(peerDb,`classes/${sharedClass}/pinnedStudents/${sharedStudent}`),true));
    await assertSucceeds(set(ref(peerDb,`boards/${sharedBoard}/teacherStrokes/shared_stroke`),{...stroke(peerUid),id:"shared_stroke"}));
    await assertSucceeds(set(ref(peerDb,`boards/${sharedBoard}/stickyNotes/shared_note`),{...stickyNote(peerUid),id:"shared_note"}));
    await assertSucceeds(set(ref(peerDb,`displays/${displayToken}`),{classId:sharedClass,active:true,studentId:sharedStudent,boardToken:sharedBoard,pageId:"main",label:"01 同學",followStudent:true,updatedAt:now,updatedBy:peerUid}));
    await assertSucceeds(set(ref(peerDb,`teacherInvites/${inviteToken}`),{classId:sharedClass,createdBy:peerUid,createdAt:now,expiresAt:now+600000}));
  });
  it("老師授權連結不能被第二個裝置重複使用",async()=>{const inviteToken="abcdefghjkmnpqrstuvwx234",now=Date.now(),teacherDb=env.authenticatedContext("teacher").database(),firstDb=env.authenticatedContext("first-monitor").database(),otherDb=env.authenticatedContext("other-monitor").database();await assertSucceeds(set(ref(teacherDb,`teacherInvites/${inviteToken}`),{classId,createdBy:"teacher",createdAt:now,expiresAt:now+600000}));await assertSucceeds(set(ref(firstDb,`teacherInvites/${inviteToken}/claimedBy`),"first-monitor"));await assertFails(set(ref(otherDb,`teacherInvites/${inviteToken}/claimedBy`),"other-monitor"));await assertFails(set(ref(otherDb,`teacherClaims/${classId}/other-monitor`),inviteToken));await assertFails(set(ref(otherDb,`classes/${classId}/admins/other-monitor`),true));});
  it("過期的老師授權連結不能被使用",async()=>{const inviteToken="23456789ABCDEFGHJKLMNPQR",otherDb=env.authenticatedContext("expired-monitor").database();await env.withSecurityRulesDisabled(async context=>set(ref(context.database(),`teacherInvites/${inviteToken}`),{classId,createdBy:"teacher",createdAt:1,expiresAt:2}));await assertFails(set(ref(otherDb,`teacherInvites/${inviteToken}/claimedBy`),"expired-monitor"));});
  it("六位數密鑰可授權不限數量的老師",async()=>{const unlimitedClass="class-unlimited",key="654321",now=Date.now();await env.withSecurityRulesDisabled(async context=>await update(ref(context.database()),{[`classes/${unlimitedClass}`]:{title:"不限老師",className:"",activityName:"",createdAt:now,expiresAt:now+36000000,updatedAt:now,status:"active",allowStudentWriting:true,allowStudentClear:false,showTeacherAnnotations:true,studentCount:0,admins:{"unlimited-teacher":true},studentOrder:{}},[`teacherKeys/${unlimitedClass}`]:key}));for(let i=1;i<=8;i++){const uid=`unlimited-teacher-${i}`,db=env.authenticatedContext(uid).database();await assertSucceeds(set(ref(db,`teacherKeyClaims/${unlimitedClass}/${uid}`),key));await assertSucceeds(set(ref(db,`classes/${unlimitedClass}/admins/${uid}`),true));await assertSucceeds(set(ref(db,`userClasses/${uid}/${unlimitedClass}`),true));await assertSucceeds(set(ref(db,`teacherKeyClaims/${unlimitedClass}/${uid}`),null));await assertSucceeds(get(ref(db,`classes/${unlimitedClass}`)));}});
  it("課程到期時間建立後不可延長",async()=>{const db=env.authenticatedContext("teacher").database(),current=(await get(ref(db,`classes/${classId}/expiresAt`))).val();await assertFails(set(ref(db,`classes/${classId}/expiresAt`),current+60000));});
  it("到期後禁止修改但允許老師完整刪除",async()=>{const expiredClass="expired-class",expiredStudent="expired-student",expiredBoard="ExpiredBoardToken23456789",now=Date.now(),pages={main:{id:"main",order:0,createdAt:now,createdBy:"expired-teacher"}};await env.withSecurityRulesDisabled(async context=>update(ref(context.database()),{[`classes/${expiredClass}`]:{title:"已到期",className:"",activityName:"",createdAt:now-36000001,expiresAt:now-1,updatedAt:now-1,status:"active",allowStudentWriting:true,allowStudentClear:false,showTeacherAnnotations:true,studentCount:1,admins:{"expired-teacher":true},studentOrder:{[expiredStudent]:0},boardPages:pages},[`students/${expiredStudent}`]:{classId:expiredClass,boardToken:expiredBoard,seatNumber:"01",displayName:"到期學生",studentUid:"expired-student-device",enabled:true,locked:false,createdAt:now-1,updatedAt:now-1},[`boardLookup/${expiredBoard}`]:{classId:expiredClass,studentId:expiredStudent},[`boardPages/${expiredBoard}`]:pages,[`boards/${expiredBoard}/meta`]:{classId:expiredClass,studentId:expiredStudent,revision:0,updatedAt:now-1},[`userClasses/expired-teacher/${expiredClass}`]:true}));const teacherDb=env.authenticatedContext("expired-teacher").database(),studentDb=env.authenticatedContext("expired-student-device").database();await assertSucceeds(get(ref(studentDb,`classes/${expiredClass}/expiresAt`)));await assertFails(update(ref(teacherDb,`classes/${expiredClass}`),{title:"不可修改"}));await assertFails(update(ref(studentDb,`students/${expiredStudent}`),{updatedAt:now}));await assertFails(set(ref(studentDb,`boards/${expiredBoard}/studentStrokes/stroke_1`),stroke("expired-student-device")));await assertFails(set(ref(teacherDb,`boards/${expiredBoard}/teacherStrokes/stroke_1`),stroke("expired-teacher")));await assertSucceeds(update(ref(teacherDb),{[`classes/${expiredClass}`]:null,[`students/${expiredStudent}`]:null,[`boardLookup/${expiredBoard}`]:null,[`boards/${expiredBoard}`]:null,[`boardPages/${expiredBoard}`]:null,[`userClasses/expired-teacher/${expiredClass}`]:null}));});
});
