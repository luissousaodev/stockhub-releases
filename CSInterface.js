/*
 * CSInterface - Adobe CEP Communication Library
 * Minimal version for StockHub extension
 * Full version: https://github.com/AdobeCEP/CEP-Resources
 */

function CSInterface() {}

CSInterface.prototype.evalScript = function(script, callback) {
    if (callback === null || callback === undefined) {
        callback = function() {};
    }
    window.__adobe_cep__.evalScript(script, callback);
};

CSInterface.prototype.getSystemPath = function(pathType) {
    var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
    var OSVersion = this.getOSInformation();
    if (OSVersion.indexOf("Windows") >= 0) {
        path = path.replace("file:///", "");
    } else if (OSVersion.indexOf("Mac") >= 0) {
        path = path.replace("file://", "");
    }
    return path;
};

CSInterface.prototype.getOSInformation = function() {
    var userAgent = navigator.userAgent;
    if (userAgent.indexOf("Windows") >= 0) {
        return "Windows";
    } else if (userAgent.indexOf("Mac") >= 0) {
        return "Mac";
    }
    return "Unknown";
};

CSInterface.prototype.openURLInDefaultBrowser = function(url) {
    if (typeof cep !== "undefined" && cep.util) {
        cep.util.openURLInDefaultBrowser(url);
    }
};

CSInterface.EXTENSION_ROOT = "extension.root";
CSInterface.SYSTEM_USER_DOCUMENTS = "user.documents";

var SystemPath = {
    EXTENSION: "extension.root",
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    HOST_APPLICATION: "hostApplication"
};
