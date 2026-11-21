/** 라이브 백엔드 주소 스위치 자리. 지금은 값을 읽어 안내만 보여 주고, 연결 기능은 없다(브라우저 시뮬레이션만). */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';
