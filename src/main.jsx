import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// 원본 파일 맨 아래에 있던 이 줄이 여기로 옮겨왔어요:
// ReactDOM.createRoot(document.getElementById("root")).render(<PortfolioConsole />);
ReactDOM.createRoot(document.getElementById('root')).render(<App />)

// 원본 <script> 태그로 body 맨 아래에 있던 PWA 서비스 워커 등록 코드예요.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('PWA 서비스 워커 등록 성공:', reg.scope))
      .catch((err) => console.error('PWA 서비스 워커 등록 실패:', err))
  })
}
