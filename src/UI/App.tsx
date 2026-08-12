
import { useState } from 'react';
import './App.css'

function App() {
  const [userInput, setUserInput] = useState('');
  const [passInput, setPassInput] = useState('');

  const handleSend = async () => {
    if(userInput.trim() !== '' && passInput.trim() !== '') {
      await window.electronAPI.sendData({ user: userInput, password: passInput });
    }
  };
  return (
    <div className="mainContainer">
      <div className="loginContainer">
        <div>
          USUARIO:
          <input
          value={userInput} onChange={(e) => setUserInput(e.target.value)} type="text" name="userInput"/>
        </div>
        <div>
          SENHA:
          <input 
          value={passInput} onChange={(e) => setPassInput(e.target.value)} type="password" name="passInput"/>
        </div>
        <div>
          <button onClick={handleSend}>ENVIAR</button>
        </div>
      </div>
    </div>
  )
}
export default App
