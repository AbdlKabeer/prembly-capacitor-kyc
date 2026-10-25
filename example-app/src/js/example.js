import { PremblyDevice } from 'prembly-capacitor-kyc';

window.testEcho = () => {
    const inputValue = document.getElementById("echoInput").value;
    PremblyDevice.echo({ value: inputValue })
}
