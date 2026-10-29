// 데이터 저장 — 이 기기(브라우저)에만 저장한다
// -------------------------------------------------------------
// 현장마다 각자 휴대폰에서 쓰는 타이머이므로 기기 저장(localStorage)만 쓴다.

function saveData(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    console.warn("저장 실패:", error);
  }
}

async function loadData(key, defaultValue = null) {
  try {
    const localData = localStorage.getItem(key);
    return localData ? JSON.parse(localData) : defaultValue;
  } catch (error) {
    console.error("데이터 로드 실패:", error);
    return defaultValue;
  }
}

function deleteData(key) {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn("삭제 실패:", error);
  }
}

function clearAllData() {
  ["teams", "settings"].forEach(deleteData);
}
