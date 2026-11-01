// 출동대편성표 읽기 (엑셀 xlsx / 한글 hwpx / PDF)
// -------------------------------------------------------------
// 세 형식 모두 먼저 "칸 격자"(병합칸은 같은 글자로 채움)로 바꾼 뒤,
// '차량' 머리칸을 기준으로 안전센터 → 차량 → 당번팀 운전요원·진압대원을 뽑는다.
(function (global) {
    const LIBS = {
        xlsx: 'lib/xlsx.full.min.js',
        jszip: 'lib/jszip.min.js',
        pdf: 'lib/pdf.min.js',
        pdfWorker: 'lib/pdf.worker.min.js'
    };

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[data-lib="${src}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = src;
            s.dataset.lib = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('라이브러리를 불러오지 못했습니다: ' + src));
            document.head.appendChild(s);
        });
    }

    const norm = (s) => String(s || '').replace(/\s+/g, '');

    // ---------------------------------------------------------- 파일 → 격자
    async function xlsxToGrids(buf) {
        if (!global.XLSX) await loadScript(LIBS.xlsx);
        const wb = global.XLSX.read(buf, { type: 'array' });
        return wb.SheetNames.map((name) => {
            const ws = wb.Sheets[name];
            const grid = global.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true })
                .map((row) => row.map((v) => String(v)));
            (ws['!merges'] || []).forEach((m) => {
                const v = (grid[m.s.r] || [])[m.s.c] || '';
                for (let r = m.s.r; r <= m.e.r; r++) {
                    grid[r] = grid[r] || [];
                    for (let c = m.s.c; c <= m.e.c; c++) grid[r][c] = v;
                }
            });
            return grid;
        });
    }

    function hwpxCellText(tc) {
        const paras = [];
        for (const p of tc.getElementsByTagNameNS('*', 'p')) {
            let text = '';
            for (const t of p.getElementsByTagNameNS('*', 't')) {
                for (const n of t.childNodes) {
                    if (n.nodeType === 3) text += n.nodeValue;
                    else if (n.localName === 'lineBreak') text += '\n';
                    else if (n.localName === 'tab') text += ' ';
                }
            }
            paras.push(text);
        }
        return paras.join('\n').trim();
    }

    async function hwpxToGrids(buf, JSZipLib, DOMParserImpl) {
        let JSZip = JSZipLib || global.JSZip;
        if (!JSZip) {
            await loadScript(LIBS.jszip);
            JSZip = global.JSZip;
        }
        const Parser = DOMParserImpl || global.DOMParser;
        const zip = await JSZip.loadAsync(buf);
        const sections = Object.keys(zip.files)
            .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
            .sort();
        const grids = [];
        for (const name of sections) {
            const xml = new Parser().parseFromString(await zip.file(name).async('string'), 'application/xml');
            for (const tbl of xml.getElementsByTagNameNS('*', 'tbl')) {
                const grid = [];
                for (const tc of tbl.getElementsByTagNameNS('*', 'tc')) {
                    // 표 안의 표는 그 표에서 따로 처리
                    let owner = tc.parentNode;
                    while (owner && owner.localName !== 'tbl') owner = owner.parentNode;
                    if (owner !== tbl) continue;
                    const addr = tc.getElementsByTagNameNS('*', 'cellAddr')[0];
                    const span = tc.getElementsByTagNameNS('*', 'cellSpan')[0];
                    if (!addr) continue;
                    const r0 = +addr.getAttribute('rowAddr');
                    const c0 = +addr.getAttribute('colAddr');
                    const rs = span ? +span.getAttribute('rowSpan') || 1 : 1;
                    const cs = span ? +span.getAttribute('colSpan') || 1 : 1;
                    const text = hwpxCellText(tc);
                    for (let r = r0; r < r0 + rs; r++) {
                        grid[r] = grid[r] || [];
                        for (let c = c0; c < c0 + cs; c++) grid[r][c] = text;
                    }
                }
                grids.push(fillHoles(grid));
            }
        }
        return grids;
    }

    function fillHoles(grid) {
        const width = Math.max(0, ...grid.map((r) => (r ? r.length : 0)));
        for (let r = 0; r < grid.length; r++) {
            grid[r] = grid[r] || [];
            for (let c = 0; c < width; c++) if (grid[r][c] == null) grid[r][c] = '';
        }
        return grid;
    }

    // PDF: 그려진 표 선으로 칸을 찾고, 글자를 그 칸에 넣는다
    async function pdfToGrids(buf, pdfjsLib) {
        let lib = pdfjsLib || global.pdfjsLib;
        if (!lib) {
            await loadScript(LIBS.pdf);
            lib = global.pdfjsLib;
            lib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker;
        }
        const doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
        const grids = [];
        for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const [ops, text] = await Promise.all([page.getOperatorList(), page.getTextContent()]);
            grids.push(pdfPageGrid(lib.OPS, ops, text.items));
        }
        return grids;
    }

    function mul(m, n) {
        return [
            m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]
        ];
    }
    const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

    function pdfSegments(OPS, opList) {
        const H = [];
        const V = [];
        const PAINT = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
            OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
        let ctm = [1, 0, 0, 1, 0, 0];
        const stack = [];
        let pending = [];

        const addLine = (a, b) => {
            if (Math.abs(a[1] - b[1]) < 0.6) H.push({ y: (a[1] + b[1]) / 2, x1: Math.min(a[0], b[0]), x2: Math.max(a[0], b[0]) });
            else if (Math.abs(a[0] - b[0]) < 0.6) V.push({ x: (a[0] + b[0]) / 2, y1: Math.min(a[1], b[1]), y2: Math.max(a[1], b[1]) });
        };
        const addRect = (x, y, w, h) => {
            const p = [apply(ctm, x, y), apply(ctm, x + w, y), apply(ctm, x + w, y + h), apply(ctm, x, y + h)];
            const xs = p.map((q) => q[0]);
            const ys = p.map((q) => q[1]);
            const x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys);
            if (y2 - y1 < 2.5 && x2 - x1 > 2.5) H.push({ y: (y1 + y2) / 2, x1, x2 });
            else if (x2 - x1 < 2.5 && y2 - y1 > 2.5) V.push({ x: (x1 + x2) / 2, y1, y2 });
            else if (x2 - x1 >= 2.5 && y2 - y1 >= 2.5) {
                // 음영칸 등 면: 네 변을 선으로 본다
                H.push({ y: y1, x1, x2 }, { y: y2, x1, x2 });
                V.push({ x: x1, y1, y2 }, { x: x2, y1, y2 });
            }
        };

        for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            const args = opList.argsArray[i];
            if (fn === OPS.save) stack.push(ctm);
            else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
            else if (fn === OPS.transform) ctm = mul(args, ctm);
            else if (fn === OPS.constructPath) {
                const [subOps, coords] = args;
                let k = 0;
                let cur = null;
                let start = null;
                for (const op of subOps) {
                    if (op === OPS.rectangle) {
                        const [x, y, w, h] = coords.slice(k, k + 4);
                        k += 4;
                        pending.push(() => addRect(x, y, w, h));
                    } else if (op === OPS.moveTo) {
                        cur = start = apply(ctm, coords[k], coords[k + 1]);
                        k += 2;
                    } else if (op === OPS.lineTo) {
                        const p = apply(ctm, coords[k], coords[k + 1]);
                        k += 2;
                        const a = cur;
                        pending.push(() => a && addLine(a, p));
                        cur = p;
                    } else if (op === OPS.curveTo) {
                        k += 6;
                    } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
                        k += 4;
                    } else if (op === OPS.closePath) {
                        const a = cur;
                        const b = start;
                        pending.push(() => a && b && addLine(a, b));
                        cur = start;
                    }
                }
            } else if (PAINT.has(fn)) {
                pending.forEach((f) => f());
                pending = [];
            } else if (fn === OPS.endPath) {
                pending = [];
            }
        }
        return { H, V };
    }

    function cluster(values, tol) {
        const sorted = [...values].sort((a, b) => a - b);
        const out = [];
        for (const v of sorted) {
            if (out.length && v - out[out.length - 1].max <= tol) {
                const g = out[out.length - 1];
                g.max = v;
                g.sum += v;
                g.n++;
            } else out.push({ min: v, max: v, sum: v, n: 1 });
        }
        return out.map((g) => g.sum / g.n);
    }
    const indexOf = (centers, v) => {
        let best = 0;
        centers.forEach((c, i) => { if (Math.abs(c - v) < Math.abs(centers[best] - v)) best = i; });
        return best;
    };

    function pdfPageGrid(OPS, opList, items) {
        const { H, V } = pdfSegments(OPS, opList);
        const tol = 1.2;
        const cells = new Map();
        const loose = [];
        for (const it of items) {
            if (!it.str || !it.str.trim()) continue;
            const t = it.transform;
            const size = Math.hypot(t[2], t[3]) || it.height || 8;
            const cx = t[4] + (it.width || 0) / 2;
            const cy = t[5] + size * 0.35;
            let top = null, bottom = null, left = null, right = null;
            for (const h of H) {
                if (h.x1 - tol > cx || h.x2 + tol < cx) continue;
                if (h.y > cy && (top === null || h.y < top)) top = h.y;
                if (h.y < cy && (bottom === null || h.y > bottom)) bottom = h.y;
            }
            for (const v of V) {
                if (v.y1 - tol > cy || v.y2 + tol < cy) continue;
                if (v.x < cx && (left === null || v.x > left)) left = v.x;
                if (v.x > cx && (right === null || v.x < right)) right = v.x;
            }
            if (top === null || bottom === null || left === null || right === null) {
                loose.push({ str: it.str, x: t[4], y: t[5], w: it.width || 0, size });
                continue;
            }
            const key = [left, right, top, bottom].map((n) => n.toFixed(1)).join(',');
            if (!cells.has(key)) cells.set(key, { left, right, top, bottom, items: [] });
            cells.get(key).items.push({ str: it.str, x: t[4], y: t[5], w: it.width || 0, size });
        }
        if (!cells.size) return looseRows(loose);

        const list = [...cells.values()];
        const xs = cluster(list.flatMap((c) => [c.left, c.right]), 1.5);
        const ys = cluster(list.flatMap((c) => [c.top, c.bottom]), 1.5).sort((a, b) => b - a);
        const grid = [];
        for (const c of list) {
            const text = cellTextFromItems(c.items);
            const c0 = indexOf(xs, c.left), c1 = indexOf(xs, c.right);
            const r0 = indexOf(ys, c.top), r1 = indexOf(ys, c.bottom);
            for (let r = r0; r < r1; r++) {
                grid[r] = grid[r] || [];
                for (let col = c0; col < c1; col++) grid[r][col] = text;
            }
        }
        // 표 밖의 글자(제목, 소방서명, 날짜)는 맨 위에 한 칸짜리 줄로 붙인다
        return fillHoles([...looseRows(loose), ...grid]);
    }

    function looseRows(items) {
        const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > a.size * 0.5 ? b.y - a.y : a.x - b.x));
        const rows = [];
        let line = null;
        for (const it of sorted) {
            const sameLine = line && Math.abs(line.y - it.y) <= it.size * 0.5;
            if (sameLine && it.x - line.end <= it.size * 3) {
                line.text += (it.x - line.end > it.size * 0.25 ? ' ' : '') + it.str;
                line.end = it.x + it.w;
            } else {
                line = { y: it.y, text: it.str, end: it.x + it.w };
                rows.push(line);
            }
        }
        return rows.map((l) => [l.text.trim()]);
    }

    // 칸 안의 글자 조각을 줄 단위로 합친다.
    // PDF 는 칸이 좁아 저절로 줄바꿈된 것이므로 줄을 그냥 이어 붙이고,
    // "주)", "야)" 로 시작하는 줄만 새 줄로 남긴다.
    function cellTextFromItems(items) {
        const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > a.size * 0.5 ? b.y - a.y : a.x - b.x));
        const lines = [];
        for (const it of sorted) {
            const line = lines[lines.length - 1];
            if (line && Math.abs(line.y - it.y) <= it.size * 0.5) {
                const gap = it.x - line.end;
                line.text += (gap > it.size * 0.25 ? ' ' : '') + it.str;
                line.end = it.x + it.w;
            } else lines.push({ y: it.y, text: it.str, end: it.x + it.w });
        }
        return lines.reduce((acc, l, i) => {
            const t = l.text.trim();
            if (i === 0) return t;
            return acc + (/^\(?(주|야|당)\)/.test(t) ? '\n' : '') + t;
        }, '');
    }

    // ---------------------------------------------------------- 격자 → 편성표
    function cleanName(raw) {
        let x = raw.trim();
        // (고새봄) 처럼 통째로 괄호면 벗긴다(겸직 표시)
        while (/^\([\s\S]*\)$/.test(x) && balanced(x.slice(1, -1))) x = x.slice(1, -1).trim();
        let open = (x.match(/\(/g) || []).length;
        let close = (x.match(/\)/g) || []).length;
        while (close > open && x.endsWith(')')) { x = x.slice(0, -1).trim(); close--; }
        while (open > close && x.startsWith('(')) { x = x.slice(1).trim(); open--; }
        return x;
    }
    function balanced(s) {
        let d = 0;
        for (const ch of s) {
            if (ch === '(') d++;
            else if (ch === ')' && --d < 0) return false;
        }
        return d === 0;
    }

    function splitNames(s) {
        const out = [];
        let depth = 0;
        let cur = '';
        for (const ch of s) {
            if (ch === '(') depth++;
            if (ch === ')') depth = Math.max(0, depth - 1);
            if (depth === 0 && /[,，.·\n/]/.test(ch)) {
                out.push(cur);
                cur = '';
            } else cur += ch;
        }
        out.push(cur);
        return out.map(cleanName).filter((n) => n && n !== '()');
    }

    // "주)오태양\n야)서파랑" → { day: [오태양], night: [서파랑] }
    function parseShift(text) {
        const t = String(text || '').replace(/\(\s*(주|야|당)\s*\)/g, '$1)');
        const re = /(^|\n)\s*(주|야|당)\)/g;
        const marks = [...t.matchAll(re)];
        if (!marks.length) {
            const all = splitNames(t);
            return { day: all, night: all };
        }
        const res = { day: [], night: [] };
        const head = t.slice(0, marks[0].index).trim();
        if (head) {
            const n = splitNames(head);
            res.day.push(...n);
            res.night.push(...n);
        }
        marks.forEach((m, i) => {
            const from = m.index + m[0].length;
            const to = i + 1 < marks.length ? marks[i + 1].index : t.length;
            const names = splitNames(t.slice(from, to));
            if (m[2] !== '야') res.day.push(...names);
            if (m[2] !== '주') res.night.push(...names);
        });
        return res;
    }

    function centerName(text) {
        const t = String(text || '').replace(/\s+/g, ' ');
        const full = t.match(/([가-힣A-Za-z0-9]+(?:119)?안전센터|[가-힣A-Za-z0-9]+119구조대|[가-힣A-Za-z0-9]+센터)/);
        if (full && !/^(센터장)/.test(full[1])) return full[1];
        const br = t.match(/\[([^\]]+)\]/);
        if (br) return br[1].trim() + '119안전센터';
        // "계 산\n(센터장: 일근)" 처럼 첫 줄에 센터 이름만 쓴 경우
        const first = norm(String(text || '').split(/\r?\n|\(/)[0]);
        if (!first) return '출동대';
        return /구조대$/.test(first) ? first : first + '119안전센터';
    }

    function findCell(grid, test, rows) {
        for (let r = rows ? rows[0] : 0; r < (rows ? rows[1] : grid.length); r++) {
            for (let c = 0; c < (grid[r] || []).length; c++) if (test(norm(grid[r][c]))) return [r, c];
        }
        return null;
    }

    // 같은 글자가 이어진(병합된) 열 범위
    function spanCols(row, c) {
        let a = c, b = c;
        while (a > 0 && row[a - 1] === row[c]) a--;
        while (b + 1 < row.length && row[b + 1] === row[c]) b++;
        return [a, b];
    }

    function gridToRoster(grid) {
        const hit = findCell(grid, (s) => s === '차량' || s === '차량명');
        if (!hit) return null;
        const [hr, vc] = hit;
        let dataStart = hr + 1;
        while (dataStart < grid.length && /^차량명?$/.test(norm(grid[dataStart][vc]))) dataStart++;
        const headRows = [hr, dataStart];
        const headRow = grid[hr];

        // 당번팀 열 범위 (없으면 차량 오른쪽 첫 묶음)
        const duty = findCell(grid, (s) => s.includes('당번') && !s.includes('비번'), headRows);
        let [ta, tb] = duty && duty[1] > vc ? spanCols(grid[duty[0]], duty[1]) : spanCols(headRow, vc + 1);
        if (!duty || duty[1] <= vc) {
            // 차량 오른쪽 열이 '운전'만 덮으면 그 다음 진압까지 포함
            tb = Math.max(tb, ta + 1);
        }
        // "3팀(당번)" / "당번(1팀)" 둘 다 → "3팀" / "1팀"
        const dutyText = duty && duty[1] > vc ? norm(grid[duty[0]][duty[1]]) : '';
        const dutyTeam = (dutyText.match(/\d+팀/) || [dutyText.replace(/\(.*\)/, '')])[0];

        let driverCol = null;
        let crewCol = null;
        for (let r = hr; r < dataStart; r++) {
            for (let c = ta; c <= tb; c++) {
                const s = norm(grid[r][c]);
                if (driverCol === null && s.includes('운전')) driverCol = c;
                if (crewCol === null && (s.includes('진압') || s.includes('대원') || s.includes('탑승'))) crewCol = c;
            }
        }
        if (driverCol === null) driverCol = ta;
        if (crewCol === null) crewCol = Math.min(tb, driverCol + 1);

        const cc = findCell(grid, (s) => s.includes('안전센터') || s === '센터' || s === '출동대', headRows);
        const centerCol = cc && cc[1] < vc ? cc[1] : null;

        const centers = [];
        let prevKey = null;
        for (let r = dataStart; r < grid.length; r++) {
            const row = grid[r];
            const vRaw = String(row[vc] || '').trim();
            const v = norm(vRaw);
            if (/사고내용|소내근무|근무자|^시간$|비고|범례/.test(v)) break;
            if (!v) continue;
            if (/^\d+대$/.test(v)) continue; // 센터별 소계 줄 ("13대 | 당7 | …")
            const center = centerCol !== null ? centerName(row[centerCol]) : '출동대';
            const key = [center, vRaw, row[driverCol], row[crewCol]].join('|');
            if (key === prevKey) continue; // 병합으로 같은 줄이 반복된 경우
            prevKey = key;

            const paren = vRaw.indexOf('(');
            // "생활\n구조차" → 생활구조차, "전기차 화재진압 \n트레일러" → 전기차 화재진압 트레일러
            const name = (paren > 0 ? vRaw.slice(0, paren) : vRaw).replace(/[ \t]+\r?\n\s*/g, ' ').replace(/\s*\n\s*/g, '').trim();
            const equipment = paren > 0 ? cleanName(vRaw.slice(paren)).replace(/\s*\n\s*/g, ' ').replace(/\)\s*\(/g, ') (') : '';

            let target = centers.find((c) => c.name === center);
            if (!target) centers.push((target = { name: center, vehicles: [] }));
            target.vehicles.push({
                name,
                equipment,
                driver: parseShift(row[driverCol]),
                crew: crewCol !== driverCol ? parseShift(row[crewCol]) : { day: [], night: [] }
            });
        }
        if (!centers.length) return null;

        const org = findCell(grid, (s) => /소방서|본부/.test(s));
        const date = findCell(grid, (s) => /\d{4}년\d{1,2}월\d{1,2}일/.test(s));
        return {
            org: org ? String(grid[org[0]][org[1]]).trim() : '',
            date: date ? String(grid[date[0]][date[1]]).replace(/\s+/g, ' ').trim() : '',
            dutyTeam,
            centers
        };
    }

    // 여러 표 중 편성표가 들어 있는 것을 고르고, 머리글(소방서·날짜)은 다른 표에서라도 찾는다
    function gridsToRoster(grids) {
        let roster = null;
        for (const g of grids) {
            const r = gridToRoster(g);
            if (r && (!roster || countVehicles(r) > countVehicles(roster))) roster = r;
        }
        if (!roster) return null;
        for (const g of grids) {
            if (!roster.org) {
                const hit = findCell(g, (s) => /소방서|본부/.test(s));
                if (hit) roster.org = String(g[hit[0]][hit[1]]).trim();
            }
            if (!roster.date) {
                const hit = findCell(g, (s) => /\d{4}년\d{1,2}월\d{1,2}일/.test(s));
                if (hit) roster.date = String(g[hit[0]][hit[1]]).replace(/\s+/g, ' ').trim();
            }
        }
        // 이름 없이 "구조대"라고만 쓴 칸 → "계양119구조대" (소방서 이름에서)
        const station = (roster.org.match(/([가-힣]+)소방서/) || [])[1];
        if (station) {
            const short = station.replace(/^(인천|서울|부산|대구|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?=[가-힣]{2})/, '');
            roster.centers.forEach((c) => { if (c.name === '구조대') c.name = short + '119구조대'; });
        }
        return roster;
    }
    const countVehicles = (r) => r.centers.reduce((n, c) => n + c.vehicles.length, 0);

    async function parseRosterFile(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const buf = await file.arrayBuffer();
        let grids;
        if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') grids = await xlsxToGrids(buf);
        else if (ext === 'hwpx') grids = await hwpxToGrids(buf);
        else if (ext === 'pdf') grids = await pdfToGrids(buf);
        else if (ext === 'hwp') throw new Error('hwp 파일은 읽을 수 없습니다. 한글에서 "다른 이름으로 저장 → hwpx" 로 저장한 뒤 올려 주세요.');
        else throw new Error('엑셀(xlsx), 한글(hwpx), PDF 파일만 올릴 수 있습니다.');

        const roster = gridsToRoster(grids);
        if (!roster) throw new Error('"차량" 칸이 있는 출동대편성표를 찾지 못했습니다.');
        roster.fileName = file.name;
        roster.loadedAt = Date.now();
        return roster;
    }

    const api = { parseRosterFile, xlsxToGrids, hwpxToGrids, pdfToGrids, pdfPageGrid, gridsToRoster, gridToRoster, parseShift };
    global.Roster = api;
    if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
