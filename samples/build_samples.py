# 출동대편성표 샘플(엑셀/한글/PDF) 만들기
#   python samples/build_samples.py
# 같은 표 정의(LAYOUT)로 xlsx 는 openpyxl, hwpx·pdf 는 한글(HWP) 프로그램을 자동 조작해 만든다.
# 결과는 앱에서 바로 체험·내려받기 하도록 public/samples/roster-sample.* 로 저장한다.
# 이름은 모두 가짜(예시)다.
import os
import sys
import html

from openpyxl import Workbook
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'samples')
BASE = 'roster-sample'
NAME = '출동대편성표'

BLUE = '1F3FD8'
RED = 'FF0000'
PINK = 'EE82EE'
ORANGE = 'ED7D31'
HEAD_FILL = 'DCE6F1'

# 열 너비(px)
COLS = [110, 94, 142, 123, 116, 208, 123, 105, 79, 116, 122, 101, 73, 80, 51, 66, 223]
# 행 높이(px)
# 차량 행과 하단 행 높이는 UNITS 를 읽으며 뒤에 붙인다
ROWS = [70, 70, 68, 35, 69, 35, 34, 34, 35, 34, 24, 107, 69]


def run(text, color=None):
    return (text, color)


# (행, 열, 행병합, 열병합, 내용, 스타일)
#   내용: 문자열 또는 [(글자, 색)] 목록
#   스타일: h=머리칸 음영, l=왼쪽 정렬, s=음영만(빈칸), banner/title/org/date=제목줄(테두리 없음)
LAYOUT = [
    (0, 0, 1, 17, [run('조직과 동료 가족을 위해 ', BLUE), run('음주운전', RED), run(' 제로화!', BLUE)], 'banner'),
    (1, 0, 1, 17, '출   동   대   편   성   표', 'title'),
    (2, 0, 1, 9, '인천계양소방서[당번(3팀)]', 'org'),
    (2, 9, 1, 8, '2026년 10월 28일 수요일', 'date'),

    # 인원 현황
    (3, 0, 2, 1, '총원', 'h'), (3, 1, 2, 3, '54명', ''),
    (3, 4, 4, 1, '사 고', 'h'), (3, 5, 4, 1, '8명', ''),
    (3, 6, 1, 8, '사 고 내 용', 'h'),
    (3, 14, 2, 2, '자택\n대기', 'h'), (3, 16, 2, 1, '현 재 원', 'h'),
    (4, 6, 1, 1, '구\n분', ''), (4, 7, 1, 1, '휴가', ''), (4, 8, 1, 1, '병가', ''),
    (4, 9, 1, 1, '공가', ''), (4, 10, 1, 1, '특휴', ''), (4, 11, 1, 1, '교육', ''),
    (4, 12, 1, 1, '출장', ''), (4, 13, 1, 1, '기타', ''),
    (5, 0, 2, 1, '센터장', 'h'), (5, 1, 2, 3, '당번', ''),
    (5, 6, 1, 1, '주간', ''), (6, 6, 1, 1, '야간', ''),
    (5, 7, 2, 1, '1명', ''), (5, 8, 2, 1, '2명', ''), (5, 9, 2, 1, '', ''),
    (5, 10, 2, 1, '', ''), (5, 11, 2, 1, '3명', ''), (5, 12, 2, 1, '', ''),
    (5, 13, 2, 1, '2명', ''),
    (5, 14, 1, 2, '28명', ''), (5, 16, 1, 1, '17명', ''),
    (6, 14, 1, 2, '28명', ''), (6, 16, 1, 1, '17명', ''),

    # 출동대 요약
    (7, 0, 3, 1, '출 동 대', 'h'),
    (7, 1, 1, 3, '출 동 인 원', 'h'), (7, 4, 1, 3, '출 동 대 장', 'h'),
    (7, 7, 1, 2, '현장안전점검관', 'h'), (7, 9, 1, 3, '차 량 대 수', 'h'),
    (7, 12, 1, 3, '경 방', 'h'), (7, 15, 1, 2, '운 전', 'h'),
    (8, 1, 1, 2, '주 간', ''), (8, 3, 1, 1, '17명', ''), (8, 4, 1, 3, '센터장', ''),
    (8, 7, 1, 2, '김가람', ''), (8, 9, 2, 3, '21대', ''),
    (8, 12, 1, 3, '10명', ''), (8, 15, 1, 2, '7명', ''),
    (9, 1, 1, 2, '야 간', ''), (9, 3, 1, 1, '17명', ''), (9, 4, 1, 3, '센터장', ''),
    (9, 7, 1, 2, '김가람', ''), (9, 12, 1, 3, '10명', ''), (9, 15, 1, 2, '7명', ''),

    # 차량별 편성 머리칸
    (11, 0, 2, 1, '안전센터', 'h'), (11, 1, 2, 1, '센터장', 'h'), (11, 2, 2, 1, '차  량', 'h'),
    (11, 3, 1, 3, '3팀(당번)', 'h'), (11, 6, 1, 4, '1팀(비번)', 'h'), (11, 10, 1, 5, '2팀(비번)', 'h'),
    (11, 15, 2, 2, '○ 사 고 내 용', 'h'),
    (12, 3, 1, 1, '운전요원\n주1/야2/당5', 'h'), (12, 4, 1, 2, '진압대원\n주2/야2/당9', 'h'),
    (12, 6, 1, 1, '운전요원6', 'h'), (12, 7, 1, 3, '진압대원\n비8', 'h'),
    (12, 10, 1, 1, '운전요원4', 'h'), (12, 11, 1, 4, '진압대원\n비7', 'h'),

    # 차량별 편성(센터별)과 하단은 아래 UNITS 에서 행 번호를 계산해 붙인다
]

# 차량별 편성: 차량, 3팀 운전, 3팀 진압, 1팀 운전, 1팀 진압, 2팀 운전, 2팀 진압
JAKJEON = [
    ('펌프차\n(질식덮개,\n관통관창,\n상방관창)', '홍길동',
     '주)센터장(안전),김가람(R),이나래\n야)센터장(안전),김가람(R),박다솜(R),이나래',
     '최라온', '정마루(안전), 강바다, 조사랑', '윤아름', '장자람(안전), 임찬솔, 한카라'),
    ('화학차\n(질식덮개,\n상방관창)', [run('주)'), run('오태양', BLUE), run('\n야)'), run('서파랑', BLUE)],
     [run('주)신하늘,권가온,'), run('황나길', BLUE), run('\n야)신하늘,'), run('안다온', BLUE)],
     '송라희', '', '', '전마음.홍바름'),
    ('생활\n구조차', [run('고새봄', BLUE)], '문아라', '양자두', '손차돌', '', ''),
    ('산불진화차', '(고새봄)', '(문아라)', '(양자두)', '(손차돌)', '()', '()'),
    ('조연차', '(배하랑)', '', '', '', '(백가비)', ''),
    ('굴절차', '배하랑', '(남 결)', '', '', '백가비', ''),
    ('고성능', [run('노다래', PINK)], '(남 결)', [run('하라율', PINK)], '', [run('곽마노', PINK)], ''),
    ('고가차', '(노다래)', '(남 결)', '(하라율)', '', '(곽마노)', ''),
    ('콤비차', '(주)오태양\n야)서파랑)', '', '(송라희)', '', '()', ''),
    ('특별\n구급차', '주)성보늬\n야)차소담', '주)주아토\n야)성보늬,주아토', '우재경', '구채운, 민타샤', '',
     [run('류파도, '), run('진하람(대체인력)', ORANGE)]),
    ('구급차', '나가을', [run('지누리, '), run('엄다빈(대체인력)', ORANGE)], '채라임', '원마당,천바위', '방새론', '공아린'),
    ('화물차', '(고새봄)', '', '(양자두)', '', '()', ''),
    ('전기차 화재진압\n트레일러', '(고새봄)', '(문아라)', '(양자두)', '(손차돌)', '()', '()'),
]

GYESAN = [
    ('펌프차', '도하늘', '센터장(안전),유초록,예다슬',
     '맹고운', '연바로, 제나비', '인솔빛', '감다미, 경단비'),
    ('물탱크차', '모해솔', '(예다슬)', '(맹고운)', '', '국보람', ''),
    ('구급차', '빈새롬', '피아솔, 어라온', '기하율', '편초롱', '반디울', '시나래'),
]

JANGGI = [
    ('펌프차', '추동해', '센터장(안전),왕가람,함새별',
     '판도윤', '음하진, 동주안', '경은솔', '여해든, 부시온'),
    ('물탱크차', '옥다님', '(함새별)', '(판도윤)', '', '(경은솔)', ''),
    ('구급차', '은가비', '도란솔, 견아리', '상아름', '계나린', '초여름', '빙소리'),
]

RESCUE = [
    ('구조버스', '강한별', '구조대장(안전),서기찬,윤바위,송도윤',
     '오한결', '한누리, 배도담, 안시우', '권태산', '임해솔, 조하람, 문채윤'),
    ('구조공작차', '(강한별)', '(송도윤)', '(오한결)', '', '(권태산)', ''),
]

# (안전센터 칸, 센터장 칸, 차량들, 사고내용 칸 [(시작, 행수, 글자, 스타일)], 행 높이)
UNITS = [
    ('[작전]54\n주 : 3\n야 : 4\n당번 : 14\n비번 : 25\n사고 : 8', '센터장\n(당번)', JAKJEON,
     [(0, 1, '', 's'),
      (1, 5, '연가:탁가비\n\n주간 연가: 박다솜\n\n주간 출장: 차소담', 'l'),
      (6, 1, '', 's'),
      (7, 6, '교육: 편나무(~10.30)\n        변다올,염라온(~10.29)\n\n병가: 석마리,선바람(~10.30)\n\n휴직: 설새길,길아영', 'l')],
     [80] + [52] * 12),
    ('[계산]18\n주 : 1\n야 : 1', '센터장\n(당번)', GYESAN, [(0, 3, '연가: 하늘빛', 'l')], [40] * 3),
    ('[장기]18\n주 : 1\n야 : 1', '센터장\n(당번)', JANGGI, [(0, 3, '', '')], [40] * 3),
    ('계양119구조대\n주 : 2\n야 : 2', '구조대장\n(당번)', RESCUE, [(0, 2, '교육: 누리솔(~10.31)', 'l')], [40] * 2),
]

r = 13
for center, chief, vehicles, notes, heights in UNITS:
    n = len(vehicles)
    LAYOUT += [(r, 0, n, 1, center, ''), (r, 1, n, 1, chief, '')]
    for off, rs, text, style in notes:
        LAYOUT.append((r + off, 15, rs, 2, text, style))
    for i, (veh, d3, c3, d1, c1, d2, c2) in enumerate(vehicles):
        LAYOUT += [
            (r + i, 2, 1, 1, veh, ''),
            (r + i, 3, 1, 1, d3, ''), (r + i, 4, 1, 2, c3, 'l'),
            (r + i, 6, 1, 1, d1, ''), (r + i, 7, 1, 3, c1, 'l'),
            (r + i, 10, 1, 1, d2, ''), (r + i, 11, 1, 4, c2, 'l'),
        ]
    ROWS += heights
    r += n

# 하단: 사고내용, 소내근무
B = r
LAYOUT += [
    (B, 0, 1, 4, '사고내용', 'h'), (B, 4, 1, 3, '', ''), (B, 7, 1, 4, '', ''), (B, 11, 1, 4, '', ''),
    (B, 15, 1, 2, [run('○ 당 번 자 현 황', BLUE)], 'h'),
    (B + 1, 0, 2, 3, '소내근무', 'h'), (B + 1, 3, 1, 1, '시간', 'h'), (B + 2, 3, 1, 1, '근무자', 'h'),
    (B + 1, 15, 2, 2, '', ''),
]
for i, t in enumerate(['09~12', '12~14', '14~16', '16~18', '18~20', '20~22',
                       '22~00', '00~02', '02~04', '04~06', '06~09']):
    LAYOUT.append((B + 1, 4 + i, 1, 1, t, ''))
    LAYOUT.append((B + 2, 4 + i, 1, 1, '', ''))
ROWS += [40, 30, 30]
LAST_ROW = B + 2

NO_BORDER = {'banner', 'title', 'org', 'date'}


def runs_of(content):
    return [(content, None)] if isinstance(content, str) else content


# ---------------------------------------------------------------- 엑셀
def build_xlsx(path):
    wb = Workbook()
    ws = wb.active
    ws.title = NAME
    thin = Side(style='thin', color='000000')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    fill = PatternFill('solid', fgColor=HEAD_FILL)

    for i, w in enumerate(COLS):
        ws.column_dimensions[chr(65 + i)].width = round(w / 7.5, 1)
    for i, h in enumerate(ROWS):
        ws.row_dimensions[i + 1].height = round(h * 0.75, 1)

    for r, c, rs, cs, content, style in LAYOUT:
        size = {'banner': 28, 'title': 32, 'org': 16, 'date': 16}.get(style, 11)
        bold = style in ('banner', 'title')
        parts = runs_of(content)
        cell = ws.cell(row=r + 1, column=c + 1)
        if len(parts) == 1 and parts[0][1] is None:
            cell.value = parts[0][0]
            cell.font = Font(name='맑은 고딕', size=size, bold=bold)
        else:
            cell.value = CellRichText([
                TextBlock(InlineFont(rFont='맑은 고딕', sz=size, b=bold, color=color or '000000'), text)
                for text, color in parts
            ])
        horiz = {'org': 'left', 'date': 'right', 'l': 'left'}.get(style, 'center')
        cell.alignment = Alignment(horizontal=horiz, vertical='center', wrap_text=True)
        if rs > 1 or cs > 1:
            ws.merge_cells(start_row=r + 1, start_column=c + 1, end_row=r + rs, end_column=c + cs)
        if style in NO_BORDER:
            continue
        for rr in range(r, r + rs):
            for cc in range(c, c + cs):
                x = ws.cell(row=rr + 1, column=cc + 1)
                x.border = border
                if style in ('h', 's'):
                    x.fill = fill

    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.orientation = 'portrait'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 1
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_options.horizontalCentered = True
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


def build_html(path, scale=0.385):
    # 한 쪽(A4 세로)에 들어가도록 줄인다
    def px(v):
        return max(1, round(v * scale))

    title_rows = [x for x in LAYOUT if x[5] in NO_BORDER]
    table_cells = [x for x in LAYOUT if x[5] not in NO_BORDER]
    font = 'font-family:맑은 고딕;'

    body = []
    for r, c, rs, cs, content, style in title_rows:
        if style == 'banner':
            body.append(f'<p style="text-align:center;{font}font-size:14pt;font-weight:bold;margin:0">{html_text(runs_of(content))}</p>')
        elif style == 'title':
            body.append(f'<p style="text-align:center;{font}font-size:17pt;font-weight:bold;margin:0">{html_text(runs_of(content))}</p>')
    org = next(x for x in title_rows if x[5] == 'org')[4]
    date = next(x for x in title_rows if x[5] == 'date')[4]
    body.append(
        f'<table width="{px(sum(COLS))}" style="width:{px(sum(COLS))}px;border-collapse:collapse"><tr>'
        f'<td width="{px(sum(COLS)) // 2}" style="{font}font-size:10pt;text-align:left;border:none">{html.escape(org)}</td>'
        f'<td width="{px(sum(COLS)) // 2}" style="{font}font-size:10pt;text-align:right;border:none">{html.escape(date)}</td>'
        '</tr></table>')

    # 두 개의 표: 인원현황(3~9행), 차량별 편성(11~28행)
    for lo, hi in ((3, 9), (11, LAST_ROW)):
        cells = sorted((x for x in table_cells if lo <= x[0] <= hi), key=lambda x: (x[0], x[1]))
        rows = []
        for r in range(lo, hi + 1):
            tds = []
            for rr, c, rs, cs, content, style in cells:
                if rr != r:
                    continue
                bg = f'background:#{HEAD_FILL};' if style in ('h', 's') else ''
                align = 'left' if style == 'l' else 'center'
                w = px(sum(COLS[c:c + cs]))
                tds.append(
                    f'<td rowspan="{rs}" colspan="{cs}" width="{w}" style="width:{w}px;border:1px solid #000;{bg}text-align:{align};'
                    f'vertical-align:middle;{font}font-size:5.5pt;line-height:100%;letter-spacing:-0.05em;padding:0">{html_text(runs_of(content)) or "&nbsp;"}</td>')
            rows.append(f'<tr style="height:{px(ROWS[r] * 0.75)}px">{"".join(tds)}</tr>')
        cols = ''.join(f'<col style="width:{px(w)}px">' for w in COLS)
        body.append(f'<table width="{px(sum(COLS))}" style="border-collapse:collapse;width:{px(sum(COLS))}px"><colgroup>{cols}</colgroup>{"".join(rows)}</table>')
        if hi != LAST_ROW:
            body.append('<p style="margin:0;font-size:3pt">&nbsp;</p>')

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
        for k in ('LeftMargin', 'RightMargin'):
            sec.SetItem(k, hwp.MiliToHwpUnit(6))
        for k in ('TopMargin', 'BottomMargin'):
            sec.SetItem(k, hwp.MiliToHwpUnit(6))
        for k in ('HeaderLen', 'FooterLen', 'GutterLen'):
            sec.SetItem(k, 0)
        act.Execute(pset)
        hwp.SaveAs(hwpx_path, 'HWPX', '')
        hwp.SaveAs(pdf_path, 'PDF', '')
    finally:
        hwp.Clear(1)
        hwp.Quit()


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    xlsx = os.path.abspath(os.path.join(OUT, BASE + '.xlsx'))
    htm = os.path.abspath(os.path.join(OUT, BASE + '.html'))
    build_xlsx(xlsx)
    build_html(htm)
    print('xlsx, html 완료')
    if '--no-hwp' not in sys.argv:
        build_hwp(htm, xlsx[:-5] + '.hwpx', xlsx[:-5] + '.pdf')
        os.remove(htm)
        print('hwpx, pdf 완료')
