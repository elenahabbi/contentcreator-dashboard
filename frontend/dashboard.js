const addScriptBtn = document.getElementById("addScriptBtn");

addScriptBtn.addEventListener("click", function() {
    window.location.href = "write.html";
});

const saveScript = document.getElementById("saveScript");
const scriptInput = document.getElementById("scriptInput");
const scriptList = document.getElementById("scriptList");

saveScript.addEventListener("click", function() {

    const scriptText = scriptInput.value;

    const newScript = document.createElement("p");
    newScript.textContent = scriptText;

    scriptList.appendChild(newScript);

    scriptInput.value = "";

    if (scriptText.trim() === "") {
    alert("Please write something first!");
    return;
}

});

