# 출동대편성표 샘플(엑셀/한글/PDF) 만들기
#   python samples/build_samples.py
# 실제 소방서 출동대편성표(출동인원·지휘대·현장대응단·센터별 소계 줄·사고내용 사이드 칸·범례·장비 보유현황) 모양을 따른다.
# 같은 표 정의(layout)로 xlsx 는 openpyxl, hwpx·pdf 는 한글(HWP) 프로그램을 자동 조작해 만든다.
# 결과는 앱에서 바로 체험·내려받기 하도록 public/samples/roster-sample.* 로 저장한다.
# 응원 출동 체험용으로 다른 소방서 5곳 편성표(public/samples/roster-<서>.xlsx)도 만든다.
#   python samples/build_samples.py --no-hwp   (한글 프로그램 없이 엑셀만)
# 이름은 모두 가짜(예시)다.
import os
import re
import sys
import html
import random

from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'samples')
BASE = 'roster-sample'
NAME = '출동분대표'

BLUE = '1F3FD8'
RED = 'FF0000'
ORANGE = 'ED7D31'
HEAD_FILL = 'DCE6F2'
GREEN_FILL = '92D050'
FONT = '굴림'
TITLE_FONT = '궁서체'

# 열 너비(px): A~R. A·B 는 센터 이름(병합), C 인원, D 차량, E~H 당번팀, I~K·L~P 비번팀, Q·R 사고내용
COLS = [43, 91, 89, 272, 194, 150, 272, 218, 118, 146, 143, 114, 98, 69, 89, 95, 105, 320]
# 열 위치
C_DRV, C_CREW = (4, 8), (9, 11)


def run(text, color=None):
    return (text, color)


def plain(content):
    return content if isinstance(content, str) else ''.join(t for t, _ in content)


def spaced(name):
    """두 글자 센터 이름은 실제 편성표처럼 띄어 쓴다: 계산 → 계 산"""
    return ' '.join(name) if len(name) == 2 else name


# ---------------------------------------------------------------- 인원 세기 (소계 줄)
def names_of(text):
    """'주)김가,이나(R)\n야)박다' → {'주': [...], '야': [...], '': [...]} (괄호로 쓴 겸직은 세지 않는다)"""
    out = {'': [], '주': [], '야': []}
    for line in plain(text).split('\n'):
        m = re.match(r'\s*(주|야)\)(.*)', line)
        key, body = (m.group(1), m.group(2)) if m else ('', line)
        for n in re.split(r'[,.]', body):
            n = n.strip()
            if n and not n.startswith('('):
                out[key].append(re.sub(r'\(.*\)', '', n))
    return out


def tally(cells, prefix):
    both, day, night = set(), set(), set()
    for t in cells:
        x = names_of(t)
        both |= set(x[''])
        day |= set(x['주'])
        night |= set(x['야'])
    dang = both | (day & night)
    ju, ya = day - dang, night - dang
    s = f'{prefix}{len(dang)}'
    if prefix == '당':
        s += (f'/주{len(ju)}' if ju else '') + (f'/야{len(ya)}' if ya else '')
    return s


# ---------------------------------------------------------------- 장비 보유현황 (차량 칸 글자에서 센다)
EQUIP = [('이동식수조', ('이동수조',)), ('질식소화덮개', ('질식덮개',)), ('관통형 방사장치', ('관통관창',)),
         ('상방 방사관창', ('상방관창',)), ('전기차 트레일러', ('트레일러',)), ('제동플러그', ('제동플러그', '제동 플러그')),
         ('드론(생구)', ('생활구조차',))]


def equip_counts(vehicles):
    text = ' '.join(plain(v[0]).replace('\n', ' ') for v in vehicles)
    return [sum(text.count(k) for k in keys) for _, keys in EQUIP]


# ---------------------------------------------------------------- 표 만들기
# 칸: (행, 열, 행병합, 열병합, 내용, 스타일)
#   내용: 문자열 또는 [(글자, 색)] 목록
#   스타일(띄어 쓴 낱말): h=머리칸 음영, g=초록 음영, l=왼쪽 정렬, b=굵게, big=큰 글씨(당번팀),
#                        title/org/date=제목줄(테두리 없음)
def make_layout(st):
    L = []
    rows = {}

    def cell(r, c, rs, cs, content, style=''):
        L.append((r, c, rs, cs, content, style))

    t_duty, t_a, t_b = st['teams']
    centers = st['centers']

    # 제목, 소방서·날짜
    cell(0, 0, 1, 18, '출  동  대  편  성  표', 'title')
    cell(1, 0, 1, 10, st['org'], 'org')
    cell(1, 10, 1, 8, st['date'], 'date')
    rows.update({0: 106, 1: 35})

    # 기상
    cell(2, 0, 1, 2, '기상상태', 'h b')
    cell(2, 2, 1, 16, st['weather'], 'l')
    cell(3, 0, 1, 2, '기상특보', 'h b')
    cell(3, 2, 1, 3, '', '')
    cell(3, 5, 1, 1, '종류', 'h b')
    cell(3, 6, 1, 12, '[-]강풍 [-]호우 [-]대설 [-]한파 [-]태풍 [-]폭염 [-]기타', 'l')
    rows.update({2: 47, 3: 47})

    # 출동인원
    p = st['people']
    heads = ['출동인원', '출동대', '소방차량', '단장', '지휘팀장', '센터장', '내 근', '운전요원', '진압대원',
             '현장지휘', '안전', '화재조사', '당직', '현   원']
    spans = [2, 1, 1, 1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 1]
    c = 0
    for h, w in zip(heads, spans):
        cell(4, c, 1, w, h, 'h b')
        c += w
    cell(4, 17, 1, 1, f'{p["total"]}명', 'h b')
    for r, label, vals, side in ((5, '주간', p['day'], ('사고', f'{p["absent"]}명')),
                                 (6, '야간', p['night'], ('근무인원', f'{p["total"] - p["absent"]}명'))):
        cell(r, 0, 1, 1, label, 'h')
        cell(r, 1, 1, 1, str(sum(vals[2:])), '')
        c = 2
        for v, w in zip(vals, spans[1:-1]):
            cell(r, c, 1, w, str(v), '')
            c += w
        cell(r, 16, 1, 1, side[0], '')
        cell(r, 17, 1, 1, side[1], '')
    rows.update({4: 47, 5: 47, 6: 47})

    # 긴급구조현장지휘대(지원반)
    g = st['support']
    cell(7, 0, 2, 3, '긴급구조현장지휘대(지원반)', 'g b')
    cell(7, 3, 1, 1, '조', 'h b')
    cell(7, 4, 1, 1, '조장', 'h b')
    cell(7, 5, 1, 4, '자원지원요원', 'h b')
    cell(7, 9, 1, 7, '상황조사요원', 'h b')
    cell(7, 16, 1, 2, '구급지휘요원', 'h b')
    cell(8, 3, 1, 1, g['group'], '')
    cell(8, 4, 1, 1, g['leader'], '')
    cell(8, 5, 1, 4, g['resource'], '')
    cell(8, 9, 1, 7, g['survey'], '')
    cell(8, 16, 1, 2, g['ems'], '')
    rows.update({7: 52, 8: 52})

    # 출동 및 자택 대기 · 현장대응단
    d = st['duty']
    cell(9, 0, 1, 3, '출동 및 자택 대기', 'h b')
    cell(9, 3, 1, 1, '당직관', 'h b')
    cell(9, 4, 1, 1, '당직자', 'h b')
    cell(9, 5, 1, 11, '현장대응단', 'h b')
    cell(9, 16, 1, 2, '<사 고 인 원>', 'h b')
    cell(10, 0, 2, 1, '주간', 'h')
    cell(12, 0, 2, 1, '야간', 'h')
    for i, (kind, n) in enumerate([('출     동', p['out_day']), ('자택대기', p['home_day']),
                                   ('출     동', p['out_night']), ('자택대기', p['home_night'])]):
        cell(10 + i, 1, 1, 1, kind, 'h')
        cell(10 + i, 2, 1, 1, f'{n}명', '')
    cell(10, 3, 4, 1, d['officer'], 'b')
    cell(10, 4, 4, 1, d['clerk'], 'b')
    cell(10, 6, 4, 1, f'당번\n({t_duty})', 'h b')
    cell(10, 9, 4, 1, f'비번\n({t_a})', 'h')
    cell(10, 12, 4, 2, f'비번\n({t_b})', 'h')
    for i, (role, names) in enumerate(d['roles']):
        cell(10 + i, 5, 1, 1, role, '')
        cell(10 + i, 7, 1, 2, names[0], 'big')
        cell(10 + i, 10, 1, 2, names[1], '')
        cell(10 + i, 14, 1, 2, names[2], '')
    cell(10, 16, 3, 2, st['absent_summary'], 'l')
    cell(13, 16, 1, 2, '별도정원 : 4\n(휴직 3, 공로연수 1)', '')
    rows.update({9: 47, 10: 67, 11: 88, 12: 93, 13: 86})

    # 차량별 편성 머리칸
    cell(14, 0, 3, 2, '출동대', 'h b big')
    cell(14, 2, 3, 1, '계', 'h b big')
    cell(14, 3, 2, 1, '차  량', 'h b big')
    cell(14, 4, 1, 4, f'당번({t_duty})', 'h b big')
    cell(14, 8, 1, 3, f'비번({t_a})', 'h')
    cell(14, 11, 1, 5, f'비번({t_b})', 'h')
    cell(15, 4, 1, 1, '운전요원', 'h b big')
    cell(15, 5, 1, 3, '진압대원', 'h b big')
    cell(15, 8, 1, 1, '운전요원', 'h')
    cell(15, 9, 1, 2, '진압대원', 'h')
    cell(15, 11, 1, 1, '운전요원', 'h')
    cell(15, 12, 1, 4, '진압대원', 'h')
    cell(14, 16, 2, 2, '사 고 내 용', 'h b big')
    rows.update({14: 52, 15: 42})

    # 센터마다: 소계 줄 + 차량 줄
    r = 16
    for i, ctr in enumerate(centers):
        vs = ctr['vehicles']
        if i:
            cell(r, 0, 1, 2, '출동대', 'h b')
            cell(r, 2, 1, 1, '계', 'h b')
        cell(r, 3, 1, 1, f'{len(vs)}대', 'h b big')
        cell(r, 4, 1, 1, tally([v[1] for v in vs], '당'), 'h b big')
        cell(r, 5, 1, 3, tally([v[2] for v in vs], '당'), 'h b big')
        cell(r, 8, 1, 1, tally([v[3] for v in vs], '비'), 'h b')
        cell(r, 9, 1, 2, tally([v[4] for v in vs], '비'), 'h b')
        cell(r, 11, 1, 1, tally([v[5] for v in vs], '비'), 'h b')
        cell(r, 12, 1, 4, tally([v[6] for v in vs], '비'), 'h b')
        rows[r] = 48
        r += 1
        cell(r, 0, len(vs), 2, ctr['label'], 'b')
        cell(r, 2, len(vs), 1, ctr['count'], 'l')
        for j, (veh, d0, c0, d1, c1, d2, c2) in enumerate(vs):
            cell(r + j, 3, 1, 1, veh, '')
            cell(r + j, 4, 1, 1, d0, 'big')
            cell(r + j, 5, 1, 3, c0, 'l big')
            cell(r + j, 8, 1, 1, d1, '')
            cell(r + j, 9, 1, 2, c1, 'l')
            cell(r + j, 11, 1, 1, d2, '')
            cell(r + j, 12, 1, 4, c2, 'l')
            rows[r + j] = 93
        r += len(vs)
    end = r

    # 사고내용 사이드 칸 (Q·R): 내근·외근 사고, 출동대장, 신속동료구조대원(RIT), 회복지원차 담당
    total = end - 16
    fixed = 6 + 2 * len(centers)
    room = max(2, total - fixed)
    k_in = room // 2
    k_out = room - k_in
    q = 16

    def side(rs, a, b=None, style=''):
        nonlocal q
        if q >= end:
            return
        rs = min(rs, end - q)
        if b is None:
            cell(q, 16, rs, 2, a, style)
        else:
            cell(q, 16, rs, 1, a, style)
            cell(q, 17, rs, 1, b, style)
        q += rs

    side(1, '내근', style='h b big')
    side(k_in, st['absent_in'], style='l')
    side(1, '외근', style='h b big')
    side(k_out, st['absent_out'], style='l')
    side(1, '출 동 대 장', style='h b')
    for ctr in centers:
        side(1, ctr['short'], ctr['chief'])
    side(1, '신속동료구조대원(RIT)', style='h b')
    for ctr in centers:
        side(1, ctr['short'], ctr['rit'])
    side(1, '회복지원차 담당', style='h b')
    side(1, centers[0]['short'], st['recovery'])
    while q < end:
        side(1, '', '')

    # 범례 · 장비 보유현황
    b = end
    n = len(centers)
    cell(b, 0, n + 2, 6, '<범례>\n1, 신속동료구조대원(일상단계 - 임시RIT) : (R)\n'
                         '2, 신속동료구조대원(대응단계 - 전문RIT) : 구조대 5~7명', 'l')
    cell(b, 6, 1, 12, '전기차 진압장비 보유현황 및 특수장비 보유현황 ', 'h b')
    eq_cols = [(8, 1), (9, 1), (10, 1), (11, 2), (13, 3), (16, 1), (17, 1)]
    cell(b + 1, 6, 1, 1, '구분', 'h')
    cell(b + 1, 7, 1, 1, '계', 'h')
    for (c, w), (label, _) in zip(eq_cols, EQUIP):
        cell(b + 1, c, 1, w, label, 'h')
    for i, ctr in enumerate(centers):
        counts = equip_counts(ctr['vehicles'])
        cell(b + 2 + i, 6, 1, 1, ctr['short'], '')
        cell(b + 2 + i, 7, 1, 1, str(sum(counts)), '')
        for (c, w), v in zip(eq_cols, counts):
            cell(b + 2 + i, c, 1, w, str(v) if v else '', '')
    for i in range(n + 2):
        rows[b + i] = 53
    last = b + n + 1
    return L, [rows.get(i, 40) for i in range(last + 1)], last


NO_BORDER = {'title', 'org', 'date'}


def runs_of(content):
    return [(content, None)] if isinstance(content, str) else content


def font_size(tokens):
    if 'title' in tokens:
        return 48
    if 'org' in tokens or 'date' in tokens:
        return 20
    return 22 if 'big' in tokens else 16


# ---------------------------------------------------------------- 엑셀
def build_xlsx(path, layout, rows):
    wb = Workbook()
    ws = wb.active
    ws.title = NAME
    thin = Side(style='thin', color='000000')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    fills = {'h': PatternFill('solid', fgColor=HEAD_FILL), 'g': PatternFill('solid', fgColor=GREEN_FILL)}

    for i, w in enumerate(COLS):
        ws.column_dimensions[chr(65 + i)].width = round(w / 7.5, 1)
    for i, h in enumerate(rows):
        ws.row_dimensions[i + 1].height = round(h * 0.75, 1)

    for r, c, rs, cs, content, style in layout:
        tokens = set(style.split())
        size = font_size(tokens)
        bold = bool(tokens & {'b', 'title', 'org', 'date'})
        name = TITLE_FONT if tokens & {'title', 'org', 'date'} else FONT
        parts = runs_of(content)
        x = ws.cell(row=r + 1, column=c + 1)
        if len(parts) == 1 and parts[0][1] is None:
            x.value = parts[0][0]
            x.font = Font(name=name, size=size, bold=bold)
        else:
            x.value = CellRichText([
                TextBlock(InlineFont(rFont=name, sz=size, b=bold, color=color or '000000'), text)
                for text, color in parts
            ])
        horiz = 'right' if 'date' in tokens else 'left' if tokens & {'l', 'org'} else 'center'
        x.alignment = Alignment(horizontal=horiz, vertical='center', wrap_text=True)
        if rs > 1 or cs > 1:
            ws.merge_cells(start_row=r + 1, start_column=c + 1, end_row=r + rs, end_column=c + cs)
        if tokens & NO_BORDER:
            continue
        fill = next((fills[k] for k in ('h', 'g') if k in tokens), None)
        for rr in range(r, r + rs):
            for cc in range(c, c + cs):
                y = ws.cell(row=rr + 1, column=cc + 1)
                y.border = border
                if fill:
                    y.fill = fill

    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
    ws.print_area = f'A1:R{len(rows)}'
    ws.page_margins.left = ws.page_margins.right = 0.3
    ws.page_margins.top = ws.page_margins.bottom = 0.4
    wb.save(path)


# ---------------------------------------------------------------- 한글용 HTML
def html_text(parts):
    out = []
    for text, color in parts:
        t = html.escape(text).replace('\n', '<br>').replace('  ', '&nbsp; ')
        out.append(f'<span style="color:#{color}">{t}</span>' if color else t)
    return ''.join(out)


def build_html(path, layout, rows, last, width=760):
    # 한 쪽(A4 세로)에 들어가도록 줄인다
    scale = width / sum(COLS)

    def px(v):
        return max(1, round(v * scale))

    font = f'font-family:{FONT};'
    title = next(x for x in layout if 'title' in x[5])[4]
    org = next(x for x in layout if 'org' in x[5])[4]
    date = next(x for x in layout if 'date' in x[5])[4]
    body = [
        f'<p style="text-align:center;font-family:{TITLE_FONT};font-size:17pt;font-weight:bold;margin:0">{html.escape(title)}</p>',
        f'<table width="{width}" style="width:{width}px;border-collapse:collapse"><tr>'
        f'<td width="{width // 2}" style="font-family:{TITLE_FONT};font-size:9pt;font-weight:bold;text-align:left;border:none">{html.escape(org)}</td>'
        f'<td width="{width // 2}" style="font-family:{TITLE_FONT};font-size:9pt;font-weight:bold;text-align:right;border:none">{html.escape(date)}</td>'
        '</tr></table>',
    ]

    cells = sorted((x for x in layout if not set(x[5].split()) & NO_BORDER), key=lambda x: (x[0], x[1]))
    trs = []
    for r in range(2, last + 1):
        tds = []
        for rr, c, rs, cs, content, style in cells:
            if rr != r:
                continue
            tokens = set(style.split())
            bg = f'background:#{HEAD_FILL};' if 'h' in tokens else f'background:#{GREEN_FILL};' if 'g' in tokens else ''
            align = 'left' if 'l' in tokens else 'center'
            weight = 'font-weight:bold;' if 'b' in tokens else ''
            size = '5.5pt' if 'big' in tokens else '5pt'
            w = px(sum(COLS[c:c + cs]))
            # 한글은 td 의 글자 크기를 무시하므로 span 에 준다
            tds.append(
                f'<td rowspan="{rs}" colspan="{cs}" width="{w}" style="width:{w}px;border:solid 1px #000000;{bg}text-align:{align};'
                f'vertical-align:middle;padding:0">'
                f'<p style="margin:0;line-height:100%;text-align:{align}"><span style="{font}{weight}font-size:{size};letter-spacing:-0.05em">'
                f'{html_text(runs_of(content)) or "&nbsp;"}</span></p></td>')
        # 줄 높이는 글자가 들어갈 만큼 한글이 늘려 주므로 낮게 준다
        trs.append(f'<tr style="height:{px(rows[r] * 0.4)}px">{"".join(tds)}</tr>')
    cols = ''.join(f'<col style="width:{px(w)}px">' for w in COLS)
    body.append(f'<table width="{width}" border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse;width:{width}px">'
                f'<colgroup>{cols}</colgroup>{"".join(trs)}</table>')

    with open(path, 'w', encoding='utf-8') as f:
        f.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>출동대편성표</title></head><body>'
                + '\n'.join(body) + '</body></html>')


# ---------------------------------------------------------------- 한글 → hwpx, pdf
def build_hwp(html_path, hwpx_path, pdf_path):
    import win32com.client as win32
    hwp = win32.gencache.EnsureDispatch('HWPFrame.HwpObject')
    try:
        hwp.XHwpWindows.Item(0).Visible = False
        # 파일 접근 보안 확인창이 뜨지 않게 한다(모듈이 등록돼 있을 때만 동작)
        try:
            hwp.RegisterModule('FilePathCheckDLL', 'FilePathCheckerModule')
        except Exception:
            pass
        hwp.Open(html_path, 'HTML', 'forceopen:true')
        # A4 세로, 여백 좁게
        act = hwp.CreateAction('PageSetup')
        pset = act.CreateSet()
        act.GetDefault(pset)
        sec = pset.CreateItemSet('PageDef', 'PageDef')
        sec.SetItem('PaperWidth', hwp.MiliToHwpUnit(210))
        sec.SetItem('PaperHeight', hwp.MiliToHwpUnit(297))
        sec.SetItem('Landscape', 0)
        for k in ('LeftMargin', 'RightMargin', 'TopMargin', 'BottomMargin'):
            sec.SetItem(k, hwp.MiliToHwpUnit(6))
        for k in ('HeaderLen', 'FooterLen', 'GutterLen'):
            sec.SetItem(k, 0)
        act.Execute(pset)
        hwp.SaveAs(hwpx_path, 'HWPX', '')
        hwp.SaveAs(pdf_path, 'PDF', '')
    finally:
        hwp.Clear(1)
        hwp.Quit()


# ---------------------------------------------------------------- 계양(기본) 더미
WEATHER = '[   ]맑음 [○]흐림 [    ]비 [   ]눈 [  ] 안개 [   ]기타(            ) / 기온(14.8℃), 풍속(2)m/sec, 강수량(-)mm, 적설량(-)'

# 차량별 편성: 차량, 당번 운전, 당번 진압, 비번A 운전, 비번A 진압, 비번B 운전, 비번B 진압
#   주)·야) = 주간·야간이 다른 칸, (이름) = 다른 차량과 겸직, (R) = 신속동료구조대원, (안전) = 안전점검관
JAKJEON = [
    ('펌프차\n(물: 3,000L, 폼: 200L)\n(질식덮개, 관통관창, 상방관창)', '홍길동',
     '주)여정훈,김가람(R),이나래(R),박다솜\n야)여정훈,김가람(R),최라온(R),박다솜',
     '정마루', '강바다,조사랑,윤아름', '장자람', '임찬솔,한카라,오태양'),
    ('화학차\n(물: 2,600L, 폼: 400L)\n(질식덮개, 상방관창)', [run('주)'), run('서파랑', BLUE), run('\n야)신하늘')],
     '권가온,황나길', '송라희', '전마음,홍바름', '고새봄', '문아라,양자두'),
    ('생활구조차', '손차돌', '배하랑', '백가비', '노다래', '하라율', '곽마노'),
    ('산불진화차\n(물: 700L)', '(손차돌)', '(배하랑)', '()', '', '(하라율)', '(곽마노)'),
    ('조연차', '주)성보늬\n야)차소담', '', '(주아토)', '', '(우재경)', ''),
    ('굴절차\n(25m)', '주)성보늬\n야)차소담', '주)센터장\n야)남 결', '주아토', '', '우재경', ''),
    ('고성능\n(물:10,000L, 폼: 1,000L\nCO2: 350L)', '주)차소담\n야)성보늬', '주)센터장\n야)남 결', '구채운', '', '민타샤', ''),
    ('고가차\n(53m)', '주)차소담\n야)성보늬', '주)센터장\n야)남 결', '(구채운)', '', '(민타샤)', ''),
    ('콤비차', '(홍길동)', '', '(정마루)', '', '(장자람)', ''),
    ('특별구급차', '류파도', '진하람,나가을', '', '지누리,편나무', '', '채라임,원마당'),
    ('구급차', '천바위', [run('방새론,'), run('공아린(대체인력)', ORANGE)], '도하늘', '변다올',
     '염라온', [run('석마리,'), run('선바람(대체인력)', ORANGE)]),
    ('화물차', '(손차돌)', '', '(백가비)', '', '(하라율)', ''),
    ('전기차 화재진압 \n트레일러', '(손차돌)', '(배하랑)', '(백가비)', '(노다래)', '(하라율)', '(곽마노)'),
]

GYESAN = [
    ('펌프차\n(물 1,200L, 폼 100L)\n(상방관창)', '도하늘', '노승현, 유초록, 예다슬',
     '맹고운', '연바로, 제나비, 인솔빛', '감다미', '경단비, 모해솔, 국보람'),
    ('물탱크차\n(물 4,500L)\n(질식덮개, 이동수조)', '빈새롬', '주)피아솔\n야)어라온', '기하율', '편초롱', '반디울', '시나래'),
    ('구급차', '추동해', '맹지환,왕가람', '함새별', '판도윤, 음하진', '동주안', '경은솔, 여해든'),
]

JANGGI = [
    ('펌프차\n(물: 1,400L, 폼: 100L)\n(관통관창)', '부시온', '옥다님(안전),은가비(R),도란솔(R)',
     '견아리', '상아름,계나린,초여름', '빙소리', '오한결,한누리'),
    ('물탱크차\n(물: 4,500L)\n(질식덮개)', '배도담', '주)안시우\n야)권태산', '임해솔', '', '조하람', '문채윤'),
    ('구급차', '강한별', '탁성민,서기찬', '윤바위', '송도윤,김로운', '이이안', '박서진,최하윤'),
]

HYOSEONG = [
    ('펌프차\n(물: 1,200L, 폼: 100L)\n(상방관창)', '주)정지안\n야)강가람', '센터장(안전),조나래(R),윤다온(R)',
     '', '장라온,임마루,한바다', '', '오사랑,서아름,신자람'),
    ('물탱크차\n(물: 6,000L)\n(질식덮개)', '권찬솔', '황카라', '안타미', '송파랑', '류하늘', '홍가온'),
    ('구급차', '전나길', '고다솜', '문라희', '양마음,손바름', '배새봄', '백아라,허자두'),
]

RESCUE = [
    ('구조차', '주)남차돌(R)\n야)심해솔', '주)구조대장(안전), 노보람\n야)하다미(안전), 남차돌(R)',
     '곽단비', '성고운, 차바로', '주나비', '우솔빛'),
    ('구난차\n(제동 플러그)', '구새롬(R)', '주)하다미, 민아솔, 유하율(R)\n야)노보람, 나초롱, 유하율(R)',
     '', '진디울, 지지환', '', '엄새별, 채도윤'),
]

GYEYANG = {
    'org': '인천계양소방서[당번1팀]',
    'date': '2026년 10월 28일 수요일',
    'teams': ('1팀', '2팀', '3팀'),
    'weather': WEATHER,
    'people': {'total': 118, 'absent': 12, 'out_day': 52, 'home_day': 54, 'out_night': 38, 'home_night': 68,
               'day': [5, 25, 1, 1, 3, 14, 17, 22, 2, 1, 2, 0], 'night': [5, 25, 1, 1, 1, 0, 17, 20, 2, 1, 2, 2]},
    'support': {'group': 'B조', 'leader': '재난대응과장', 'resource': '원하진, 천주안, 방은솔, 공바위',
                'survey': '현가람, 함나래, 변다온, 염라희, 여마루', 'ems': '추바다'},
    'duty': {'officer': ' 소방위 도사랑 ', 'clerk': ' 소방사 소아름 ',
             'roles': [('○현장대응단장', ('석자람', '선찬솔', '설카라')),
                       ('○지휘/안전팀장', ('마타미, 길파랑', '연하늘, 위가온', '표나길')),
                       ('○지휘요원', ('명다솜, 기라희', '반마음, 왕바름', '금새봄, 옥아라')),
                       ('○화재조사요원', ('육자두, 인차돌', '맹해솔, 제보람', '모다미, 탁단비'))]},
    'absent_summary': '   연가 : 4       병가 : 2\n   공가 : 0       특휴 : 0\n   교육 : 3       출장 : 2\n'
                      '   당휴 : 1       대휴 : 0\n   파견 : 0       휴직 : 0\n   기타 : 0',
    'absent_in': '< 소 방 행 정 과 >\n출장: 국고운\n< 예 방 안 전 과 >\n연가: 어바로, 은나비\n당휴: 편솔빛\n'
                 '< 재 난 대 응 과 >\n\n< 현 장 대 응 단 >\n병가: 용새롬',
    'absent_out': '<   작    전   >\n교육: 예아솔, 경하율\n병가: 봉초롱\n\n<   계    산   >\n연가: 김디울\n\n'
                  '<   장    기   >\n\n<   효    성   >\n연가: 이지환, 박새별\n\n<   구 조 대  >\n교육: 최도윤\n출장: 정하진',
    'recovery': '배하랑',
    'centers': [
        {'label': '작전\n(센터장: 일근)', 'short': '작전', 'vehicles': JAKJEON,
         'count': '총원 : 54\n주간 : 2\n야간 : 1\n당번 : 17\n비번 : 27\n사고 : 7',
         'chief': '주)센터장\n야)여정훈', 'rit': '김가람, 이나래'},
        {'label': '계 산\n(센터장: 일근)', 'short': '계산', 'vehicles': GYESAN,
         'count': '총원 : 28\n주간 : 1\n야간 : 1\n당번 : 8\n비번 : 18',
         'chief': '주)센터장\n야)노승현', 'rit': '유초록, 예다슬'},
        {'label': '장 기\n(센터장: 비번)', 'short': '장기', 'vehicles': JANGGI,
         'count': '총원 : 28\n주간 : 1\n야간 : 1\n당번 : 8\n비번 : 17\n사고 : 1',
         'chief': '옥다님', 'rit': '은가비, 도란솔'},
        {'label': '효 성\n(센터장: 당번)', 'short': '효성', 'vehicles': HYOSEONG,
         'count': '총원: 28\n주간: 1\n야간: 1\n당번: 7\n사고: 3\n비번: 16',
         'chief': '센터장', 'rit': '조나래, 윤다온'},
        {'label': '구조대\n(대장: 일근)', 'short': '구조대', 'vehicles': RESCUE,
         'count': '총원 : 22\n주간 : 2\n야간 : 2\n당번 : 5\n비번 : 10\n사고 : 3',
         'chief': '주)구조대장\n야)하다미', 'rit': '일상 + 2명'},
    ],
}


# ---------------------------------------------------------------- 응원 출동용 다른 소방서 (가짜 이름)
# 차량 이름만 정하면 대원 이름은 가짜로 채운다. 내부 진입 차량은 대원 여럿, 나머지는 겸직(괄호)
SURNAMES = '김이박최정강조윤장임한오서신권황안송류홍전고문양손배백허남심노하곽성차주우구민유나진지엄채원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉'
GIVEN = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아름', '자람', '찬솔', '카라', '타미', '파랑', '하늘',
         '가온', '나길', '다솜', '라희', '마음', '바름', '새봄', '아라', '자두', '차돌', '해솔', '보람', '다미', '단비',
         '고운', '바로', '나비', '솔빛', '새롬', '아솔', '하율', '초롱', '디울', '지환', '새별', '도윤', '하진',
         '주안', '은솔', '해든', '시온', '다님', '가비', '란솔', '아리', '나린', '여름', '소리', '한결', '누리', '도담',
         '시우', '태산', '하람', '채윤', '한별', '성민', '기찬', '바위', '로운', '이안', '서진', '하윤', '지안']
_used = set()


def fake_names(rng, n):
    out = []
    while len(out) < n:
        name = rng.choice(SURNAMES) + rng.choice(GIVEN)
        if name not in _used:
            _used.add(name)
            out.append(name)
    return out


ENTRY = ('펌프', '탱크', '구조', '화학')
EQUIP_TEXT = {'펌프차': '\n(물: 2,800L, 폼: 200L)\n(질식덮개, 상방관창)', '물탱크차': '\n(물: 4,500L)\n(질식덮개, 이동수조)',
              '화학차': '\n(물: 2,600L, 폼: 400L)', '고가차': '\n(53m)', '굴절차': '\n(25m)', '산불진화차': '\n(물: 700L)',
              '구난차': '\n(제동플러그)'}


def make_center(rng, name, chief_status, vehicles):
    rows = []
    rit = []
    for v in vehicles:
        label = v + EQUIP_TEXT.get(v, '')
        if any(k in v for k in ENTRY):
            crew = 4 if '구조' in v else 3
            d0, d1, d2 = fake_names(rng, 3)
            names = fake_names(rng, crew)
            if v == '펌프차':
                # 대장(안전) + 신속동료구조대원(R) 2명
                rit = names[1:3]
                names = [names[0] + '(안전)'] + [x + '(R)' for x in rit]
            c0 = ','.join(names)
            c1 = ', '.join(fake_names(rng, 2))
            c2 = ', '.join(fake_names(rng, 2))
        elif '구급' in v:
            d0, d1, d2 = fake_names(rng, 3)
            c0, c1, c2 = (', '.join(fake_names(rng, 2)) for _ in range(3))
        else:
            # 고가·굴절·산불진화 등은 다른 차량 대원이 겸한다
            d0, d1, d2 = (f'({x})' for x in fake_names(rng, 3))
            c0, c1, c2 = '', '', ''
        rows.append((label, d0, c0, d1, c1, d2, c2))
    rescue = name.endswith('구조대')
    n = len(vehicles)
    return {
        'label': f'구조대\n(대장: {chief_status})' if rescue else f'{spaced(name)}\n(센터장: {chief_status})',
        'short': '구조대' if rescue else name,
        'vehicles': rows,
        'count': f'총원 : {n * 6}\n주간 : 1\n야간 : 1\n당번 : {n * 2}\n비번 : {n * 4}',
        'chief': '주)구조대장' if rescue else '센터장',
        'rit': ', '.join(rit) if rit else '일상 + 2명',
    }


def make_station(rng, org, duty, centers):
    teams = ['1팀', '2팀', '3팀']
    teams.remove(duty)
    nv = sum(len(v) for _, _, v in centers)
    return {
        'org': org,
        'date': GYEYANG['date'],
        'teams': (duty, *teams),
        'weather': WEATHER,
        'people': {'total': 96, 'absent': 9, 'out_day': 40, 'home_day': 47, 'out_night': 31, 'home_night': 56,
                   'day': [len(centers), nv, 1, 1, 3, 10, 13, 17, 2, 1, 2, 0],
                   'night': [len(centers), nv, 1, 1, 1, 0, 13, 15, 2, 1, 2, 2]},
        'support': {'group': 'A조', 'leader': '재난대응과장', 'resource': ', '.join(fake_names(rng, 4)),
                    'survey': ', '.join(fake_names(rng, 5)), 'ems': fake_names(rng, 1)[0]},
        'duty': {'officer': f' 소방위 {fake_names(rng, 1)[0]} ', 'clerk': f' 소방사 {fake_names(rng, 1)[0]} ',
                 'roles': [(role, tuple(', '.join(fake_names(rng, k)) for _ in range(3)))
                           for role, k in (('○현장대응단장', 1), ('○지휘/안전팀장', 2), ('○지휘요원', 2), ('○화재조사요원', 2))]},
        'absent_summary': '   연가 : 3       병가 : 2\n   공가 : 0       특휴 : 0\n   교육 : 2       출장 : 1\n'
                          '   당휴 : 1       대휴 : 0\n   파견 : 0       휴직 : 0\n   기타 : 0',
        'absent_in': f'< 소 방 행 정 과 >\n연가: {fake_names(rng, 1)[0]}\n< 예 방 안 전 과 >\n출장: {fake_names(rng, 1)[0]}',
        'absent_out': f'<   {centers[0][0]}   >\n교육: {", ".join(fake_names(rng, 2))}\n병가: {fake_names(rng, 1)[0]}',
        'recovery': fake_names(rng, 1)[0],
        'centers': [make_center(rng, *c) for c in centers],
    }


OTHER_STATIONS = [
    ('michuhol', '인천미추홀소방서[당번1팀]', '1팀', [
        ('주안', '일근', ['펌프차', '물탱크차', '고가차', '구급차']),
        ('도화', '당번', ['펌프차', '물탱크차', '구급차']),
        ('용현', '비번', ['펌프차', '물탱크차', '굴절차', '구급차']),
        ('구조대', '일근', ['구조차', '구난차']),
    ]),
    ('geomdan', '인천검단소방서[당번2팀]', '2팀', [
        ('검단', '일근', ['펌프차', '물탱크차', '고가차', '굴절차', '산불진화차', '구급차']),
        ('원당', '당번', ['펌프차', '물탱크차', '구급차']),
        ('불로', '비번', ['펌프차', '물탱크차', '산불진화차', '구급차']),
        ('구조대', '일근', ['구조차', '구난차']),
    ]),
    ('ganghwa', '인천강화소방서[당번3팀]', '3팀', [
        ('강화', '일근', ['펌프차', '물탱크차', '굴절차', '산불진화차', '구급차']),
        ('길상', '당번', ['펌프차', '물탱크차', '산불진화차', '구급차']),
        ('교동', '비번', ['펌프차', '물탱크차', '구급차']),
        ('구조대', '일근', ['구조차', '구난차']),
    ]),
    ('seohae', '인천서해소방서[당번1팀]', '1팀', [
        ('청라', '일근', ['펌프차', '물탱크차', '고가차', '화학차', '구급차']),
        ('가정', '당번', ['펌프차', '물탱크차', '구급차']),
        ('석남', '비번', ['펌프차', '물탱크차', '굴절차', '구급차']),
        ('구조대', '일근', ['구조차', '구난차']),
    ]),
    ('bupyeong', '인천부평소방서[당번2팀]', '2팀', [
        ('삼산', '일근', ['펌프차', '물탱크차', '고가차', '구급차']),
        ('부개', '당번', ['펌프차', '물탱크차', '구급차']),
        ('십정', '비번', ['펌프차', '물탱크차', '굴절차', '화학차', '구급차']),
        ('구조대', '일근', ['구조차', '구난차']),
    ]),
]


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    # 계양에 쓴 이름은 다른 소방서에 다시 나오지 않게 한다
    for vs in (JAKJEON, GYESAN, JANGGI, HYOSEONG, RESCUE):
        for row in vs:
            for t in row[1:]:
                for names in names_of(t).values():
                    _used.update(names)

    # 계양(기본): 엑셀·한글·PDF
    layout, rows, last = make_layout(GYEYANG)
    xlsx = os.path.abspath(os.path.join(OUT, BASE + '.xlsx'))
    htm = os.path.abspath(os.path.join(OUT, BASE + '.html'))
    build_xlsx(xlsx, layout, rows)
    build_html(htm, layout, rows, last)
    print('계양 xlsx, html 완료')
    if '--no-hwp' not in sys.argv:
        build_hwp(htm, xlsx[:-5] + '.hwpx', xlsx[:-5] + '.pdf')
        print('계양 hwpx, pdf 완료')
    os.remove(htm)

    # 응원 출동용 다른 소방서: 엑셀만 (이름이 매번 같게 나오도록 씨앗 고정)
    rng = random.Random(119)
    for key, org, duty, centers in OTHER_STATIONS:
        layout, rows, _ = make_layout(make_station(rng, org, duty, centers))
        build_xlsx(os.path.join(OUT, f'roster-{key}.xlsx'), layout, rows)
        print(f'{org} xlsx 완료')
