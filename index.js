
var co = require('co');
var prompt = require('co-prompt');
var Client = require('node-rest-client').Client;
var parseString = require('xml2js').parseString;
var formurlencoded = require('form-urlencoded');
var CryptoJS = require('crypto-js');
var md5crypt = require('./libs/md5crypt');
var fs = require('fs');
var spawn = require('child-process-promise').spawn;



var client = new Client();

class Ws {
    constructor() {
        this.limit = 25;
        this.offset = 0;
        this.files = [];
        this.fsm();
    }

    fsm() {
        return this.command().then(() => {
            return this.fsm();
        })
    }

    login(username, password) {
        return this.getSalt(username).then(salt => {
            if (!salt) {
                console.log("Bad username");
                return;
            } else {
                return this.getToken(username, password, salt).then(token => {
                    if (!token) {
                        console.log("Bad login");
                    } else {
                        console.log("Login succes");
                        this.token = token;
                    }
                    return;
                })
            }
        })
    }

    getSalt(username) {
        return this.call("salt", { username_or_email: username }).then(res => {
            if (res.response.status[0] == "OK" && res.response.salt != "reset") {
                return res.response.salt[0];
            }
        });
    }

    getToken(username, password, salt) {
        var data = {
            username_or_email: username,
            password: CryptoJS.SHA1(md5crypt.md5crypt(password, salt)).toString(),
            digest: CryptoJS.MD5(username + ':Webshare:' + password).toString(),
            keep_logged_in: 1
        }
        return this.call("login", data).then(res => {
            if (res.response.status[0] == "OK") {
                return res.response.token[0];
            }
        });
    }

    search(what, offset) {
        return this.call("search", { what: what, offset: offset, limit: this.limit }).then(res => {
            if (!res.response.file) {                
                console.log("Not found");
            } else {
                this.results = res.response.file;
                this.list(this.results);
            }
            return;
        });
    }


    command() {
        return this.getFromConsole("Commad").then(input => {
            var cmds = this.getCommands();
            for (var key in cmds) {
                var cmd = cmds[key];
                var m = cmd.pattern.exec(input);
                if (m !== null) {
                    if (m.index === cmd.pattern.lastIndex) {
                        cmd.pattern.lastIndex++;
                    }
                    return cmd.cb(m);
                }
            };
            return;

        });
    }

    list(list) {
        list.forEach((element, index) => {
            console.log("(" + (index + 1) + ")", element.name[0]);
        });
    }

    getLink(ident) {
        return this.call("file_link", { ident: ident }).then(res => {
            return res.response.link[0];
        })
    }

    prepareLinksFile() {
        var links = "";
        var actions = this.files.map(file => {
            return this.getLink(file.ident[0]).then(link => {
                links += link + "\n";
            });
        });
        return Promise.all(actions).then(() => {
            fs.writeFile('.links', links, (err) => {
                if (err)
                    console.log(err);
                return
            });
        });
    }

    download() {
        return this.prepareLinksFile().then(() => {
            console.log("Download started");
            var promise = spawn("wget",['-i', '.links', "-q", "--show-progress"]);
            promise.childProcess.stderr.pipe(process.stdout)
            return promise.then(()=> console.log());
        });
    }


    getFromConsole(question) {
        return co(function* () {
            var value = yield prompt(question + ': ');
            process.stdin.pause();
            return value;
        })
    }

    call(method, data) {
        if (this.token) data.wst = this.token;
        var args = {
            headers: { Accept: 'application/xml; charset=UTF-8', "Content-Type": "application/x-www-form-urlencoded" },
            dataType: 'text',
            data: formurlencoded(data)
        };
        return new Promise((resolve, reject) => {
            client.post("http://webshare.cz/api/" + method + "/", args, function (data, response) {
                parseString(data.toString(), function (err, result) {
                    resolve(result);
                });
            });
        });
    }

    printHelp() {
        console.log("Its unstable as hell");
    }

    getCommands() {
        return {
            login: {
                pattern: /^login (\w+) (\w+)$/i,
                hint: "login #username #password",
                cb: (match) => {
                    return this.login(match[1], match[2])
                }
            },
            search: {
                pattern: /^search (\w+)$/i,
                hint: "search #what",
                cb: (match) => {
                    this.offset = 0;
                    this.what = match[1];
                    return this.search(this.what, this.offset);
                }
            },
            download: {
                pattern: /^download$/i,
                hint: "download",
                cb: (match) => {
                    return this.download();
                }
            },
            list: {
                pattern: /^list$/i,
                hint: "list",
                cb: (match) => {
                    return new Promise((resolve, reject) => {
                        this.list(this.files);
                        resolve();
                    });
                }
            },
            mark: {
                pattern: /^mark (\d+)$/i,
                hint: "mark #id",
                cb: (match) => {
                    return new Promise((resolve, reject) => {
                        this.files.push(this.results[match[1] - 1]);
                        resolve();
                    });
                }
            },
            unmark: {
                pattern: /^unmark (\d+)$/i,
                hint: "unmark #id",
                cb: (match) => {
                    return new Promise((resolve, reject) => {
                        this.files.splice(match[1] - 1, 1);
                        resolve();
                    });
                }
            },
            save: {
                pattern: /save (\w+)$/i,
                hint: "save #what",
                cb: (match) => {
                    return this.save(match[1]);
                }
            },
            more: {
                pattern: /^more$/i,
                hint: "more",
                cb: (match) => {
                    this.offset += this.limit;
                    return this.search(this.what, this.offset);
                }
            },
            help: {
                pattern: /^help$/i,
                hint: "help",
                cb: (match) => {
                    return new Promise((resolve, reject) => {
                        this.printHelp();
                        resolve();
                    });
                }
            },
        };
    }
}
ws = new Ws();