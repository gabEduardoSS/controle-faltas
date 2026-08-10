
import { useState } from 'react';
import './App.css'

function App() {
  const [input, setInput] = useState('');

  const handleSend() = async () => {
    await window.electronAPI.sendData()
  }
  return (
    <div className="mainContainer">
      <div>
        USUARIO:
        <input type="text" name="userInput" id="" />
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
