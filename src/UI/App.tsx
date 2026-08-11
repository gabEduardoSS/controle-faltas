
import { useState } from 'react';
import './App.css'

function App() {
  const [text, setText] = useState('');

  const handleSend() = async () => {
    await window.electronAPI.sendData([input, input2])
  }
  return (
    <div className="mainContainer">
      <div>
        USUARIO:
        <input
        value={text} onChange={(e) => setText(e.target.value)} type="text" name="userInput" id="" />
      </div>
      <div>
        SENHA:
        <input type="password" name="passInput" id="" />
      </div>
      <div>
        <button >ENVIAR</button>
      </div>
    </div>
  )
}

export default App
