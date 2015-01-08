var CloudCmd, Util, DOM, CloudFunc, io, ace, DiffProto, diff_match_patch, Zip, MenuIO, Format;
(function(CloudCmd, Util, DOM, CloudFunc) {
    'use strict';
    
    CloudCmd.Edit = EditProto;
        
    function EditProto(callback) {
        var Name        = 'Edit',
            Loading     = true,
            DIR         = '/modules/ace-builds/src-noconflict/',
            LIBDIR      = CloudCmd.LIBDIR,
            Info        = DOM.CurrentInfo,
            Files       = DOM.Files,
            Storage     = DOM.Storage,
            exec        = Util.exec,
            join        = CloudCmd.join,
            FileName,
            Menu,
            Value,
            Edit        = this,
            Diff,
            Emmet,
            Ace,
            Session,
            Modelist,
            Events      = DOM.Events,
            RESTful     = DOM.RESTful,
            Dialog      = DOM.Dialog,
            Images      = DOM.Images,
            Element, JSHintConfig,
            ConfigView  = {
                beforeClose: function() {
                    isChanged();
                    exec.ifExist(Menu, 'hide');
                },
                afterShow: function() {
                    Ace.clearSelection();
                    Ace.moveCursorTo(0, 0);
                    Ace.focus();
                }
            };
        
       function init(callback) {
            exec.series([
                CloudCmd.View,
                loadFiles,
                function(callback) {
                    DOM.loadSocket(initSocket);
                    callback();
                },
                function(callback) {
                    var element = createElement();
                    
                    Edit.create(element)
                        .show(callback);
                    
                }, callback]);
        }
        
        function getHost() {
            var l       = location,
                href    = l.origin || l.protocol + '//' + l.host;
            
            return href;
        }
        
        function initSocket(error) {
            var socket,
                href            = getHost(),
                FIVE_SECONDS    = 5000,
                patch    = function(name, data) {
                    socket.emit('patch', name, data);
                };
                
            if (!error) {
                socket  = io.connect(href + '/edit', {
                    'max reconnection attempts' : Math.pow(2, 32),
                    'reconnection limit'        : FIVE_SECONDS
                });
                
                socket.on('connect', function() {
                    Edit.save.patch = patch;
                });
                
                socket.on('message', function(msg) {
                    onSave(msg);
                });
                
                socket.on('patch', function(name, data, hash) {
                    if (name === FileName)
                        loadDiff(function(error) {
                            if (error)
                                console.error(error);
                            else
                                DOM.Storage.get(name + '-hash', function(error, hashLocal) {
                                    var cursor, value;
                                    
                                    if (hash === hashLocal) {
                                        cursor  = Ace.selection.getCursor(),
                                        value   = Edit.getValue();
                                        value   = Diff.applyPatch(value, data);
                                        
                                        Ace.setValue(value);
                                        
                                        sha(function(error, hash) {
                                            DOM.saveDataToStorage(name, value, hash);
                                            Ace.clearSelection();
                                            Ace.moveCursorTo(cursor.row, cursor.column);
                                            Ace.scrollToLine(cursor.row, true);
                                        });
                                    }
                                });
                        });
                });
                
                socket.on('disconnect', function() {
                    Edit.save.patch = patchHttp;
                });
                
                socket.on('err', function(error) {
                    Dialog.alert(error);
                });
            }
        }
        
        function createElement() {
            var element = DOM.load({
                name        : 'div',
                style   :
                    'width      : 100%;'    +
                    'height     : 100%;'    +
                    'font       : 16px "Droid Sans Mono";' +
                    'position   : absolute;',
                notAppend : true
            });
            
            Events.add(element, {
                contextmenu :   setMenu,
                drop        :   onDrop,
                dragover    :   Events.preventDefault
            });
            
            return element;
        }
        
        this.show                       = function(callback) {
            var isDir   = Info.isDir,
                name    = Info.name;
            
            FileName    = Info.path;
            
            Images.show.load();
            
            if (callback)
                ConfigView.beforeShow = callback;
            
            if (isDir)
                Edit.setMode('json');
            else
                Edit.setModeForPath(name);
            
            Info.getData(function(error, data) {
                if (error) {
                    alert(error);
                } else {
                    Edit.setValue(data);
                    CloudCmd.View.show(Element, ConfigView);
                }
            });
            
            return this;
        };
        
        this.getValue                   = function() {
            return Ace.getValue();
        };
        
        this.setValue                   = function(value) {
            var UndoManager = ace.require('ace/undomanager').UndoManager;
            
            Value           = value;
            
            Ace.setValue(value);
            Session.setUndoManager(new UndoManager());
        };
        
        this.hide                       = function() {
            CloudCmd.View.hide();
        };
        
        this.goToLine                   = function() {
            var msg     = 'Enter line number:',
                cursor  = Ace.selection.getCursor(),
                number  = cursor.row + 1,
                line    = Dialog.prompt(msg, number);
            
            number      = line - 0;
            
            if (number)
                Ace.gotoLine(number);
        };
        
        this.setModeForPath             = function(name) {
            var modesByName = Modelist.modesByName,
                mode        = Modelist.getModeForPath(name).mode,
                
                htmlMode    = modesByName.html.mode,
                jsMode      = modesByName.javascript.mode,
                
                isHTML      = mode === htmlMode,
                isJS        = mode === jsMode;
                
            Session.setMode(mode, function() {
                setUseOfWorker(mode);
                
                if (isHTML)
                    setEmmet();
                
                if (isJS && Session.getUseWorker())
                    setJsHintConfig();
            });
        };
        
        this.setMode                    = function(mode) {
            var ext,
                modesByName = Modelist.modesByName;
                
            if (modesByName[mode]) {
                ext = modesByName[mode].extensions.split('|')[0];
                Edit.setModeForPath('.' + ext);
            }
        };
        
        function isChanged() {
            var is,
                value   = Ace.getValue(),
                isEqual = value === Value,
                msg     = 'Do you want to save changes to ' + name + '?';
            
            if (!isEqual) {
                is = Dialog.confirm(msg);
                
                if (is)
                    Edit.save();
            }
        }
        
        function setEmmet() {
            Files.get('edit', function(error, config) {
                var extensions  = config.extensions,
                    isEmmet     = extensions.emmet;
                
                if (isEmmet)
                    exec.if(Emmet, function() {
                        Ace.setOption('enableEmmet', true);
                    }, function(callback) {
                        var url;
                        
                        url = join([
                            DIR + 'emmet.js',
                            DIR + 'ext-emmet.js'
                        ]);
                        
                        DOM.load.js(url, function() {
                            Emmet = ace.require('ace/ext/emmet');
                            Emmet.setCore(window.emmet);
                            
                            callback();
                        });
                    });
                });
        }
        
        function setUseOfWorker(mode) {
            var isMatch,
                isStr   = typeof mode === 'string',
                regStr  = 'coffee|css|html|javascript|json|lua|php|xquery',
                regExp  = new RegExp(regStr);
            
            if (isStr)
                isMatch = regExp.test(mode);
            
            Session.setUseWorker(isMatch);
        }
        
        this.create = function(element) {
            Element     = element;
            Ace         = ace.edit(element);
            Session     = Ace.getSession();
            
            Ace.commands.addCommand({
                name    : 'hide',
                bindKey : { win: 'Esc',  mac: 'Esc' },
                exec    : function () {
                    Edit.hide();
                }
            });
            
            Ace.commands.addCommand({
                name    : 'goToLine',
                bindKey : { win: 'Ctrl-G',  mac: 'Command-G' },
                exec    : function () {
                    Edit.goToLine();
                }
            });
            
            Ace.commands.addCommand({
                name    : 'save',
                bindKey : { win: 'Ctrl-S',  mac: 'Command-S' },
                exec    : function() {
                    Edit.save();
                }
            });
            
            Ace.commands.addCommand({
                name    : 'saveMC',
                bindKey : { win: 'F2',  mac: 'F2' },
                exec    : function() {
                    Edit.save();
                }
            });
            
            Ace.commands.addCommand({
                name    : 'beautify',
                bindKey : { win: 'Ctrl-B',  mac: 'Command-B' },
                exec    : function() {
                    Edit.beautify();
                }
            });
            
            Ace.commands.addCommand({
                name    : 'minify',
                bindKey : { win: 'Ctrl-M',  mac: 'Command-M' },
                exec    : function() {
                    Edit.minify();
                }
            });
            
            ace.require('ace/ext/language_tools');
            Modelist = ace.require('ace/ext/modelist');
            
            Files.get('edit', function(error, config) {
                var options      = config.options;
                    
                Ace.setOptions(options);
            });
            
            return this;
        };
        
        Edit.save = function() {
            var value   = Ace.getValue();
            
            Files.get('config', function(error, config) {
                var isDiff      = config.diff,
                    isZip       = config.zip;
                
                exec.if(!isDiff, function(patch) {
                    var query           = '',
                        MAX_SIZE        = CloudFunc.MAX_FILE_SIZE,
                        patchLength     = patch && patch.length || 0,
                        length          = Value.length,
                        isLessMaxLength = length < MAX_SIZE,
                        isLessLength    = isLessMaxLength && patchLength < length,
                        isStr           = typeof patch === 'string',
                        isPatch         = patch && isStr && isLessLength;
                    
                    Value               = value;
                    
                    exec.if(!isZip || isPatch, function(equal, data) {
                        var result  = data || Value;
                        
                        if (isPatch)
                            Edit.save.patch(FileName, patch);
                        else
                            Edit.save.write(FileName + query, result);
                    }, function(func) {
                        zip(value, function(error, data) {
                            if (error)
                                console.error(error);
                            
                            query = '?unzip';
                            func(null, data);
                        });
                    });
                    
                }, exec.with(doDiff, FileName));
            });
        };
        
        Edit.save.patch = patchHttp;
        Edit.save.write = writeHttp;
        
        function patchHttp(path, patch) {
            RESTful.patch(path, patch, onSave);
        }
        
        function writeHttp(path, result) {
            RESTful.write(path, result, onSave);
        }
        
        function doDiff(path, callback) {
            var value = Ace.getValue();
            
            diff(value, function(patch) {
                var isAllowed = Storage.isAllowed();
                
                exec.if(!isAllowed, callback, function(func) {
                    DOM.checkStorageHash(path, function(error, equal) {
                        if (!equal)
                            patch = '';
                        
                        func(patch);
                    });
                });
            });
        }
        
        function diff(newValue, callback) {
            loadDiff(function(error) {
                var patch, 
                    isAllowed   = Storage.isAllowed();
                
                if (error) {
                    Dialog.alert(error);
                } else {
                    exec.if(!isAllowed, function() {
                        patch       = Diff.createPatch(Value, newValue);
                        exec(callback, patch);
                    }, function(func) {
                        DOM.getDataFromStorage(FileName, function(error, data) {
                            if (data)
                                Value   = data;
                            
                            func();
                        });
                    });
                }
            });
        }
        
        function loadDiff(callback) {
             var url = join([
                    LIBDIR + 'diff/diff-match-patch.js',
                    LIBDIR + 'diff.js'
                ]);
            
            DOM.load.js(url, function(error) {
                if (!error && !Diff)
                    Diff        = new DiffProto(diff_match_patch);
                
                callback(error);
            });
        }
        
        function zip(value, callback) {
            var dir             = CloudCmd.LIBDIRCLIENT,
                url             = dir + 'zip.js';
            
            exec.parallel([
                function(callback) {
                    DOM.load.js(url, callback);
                },
                function(callback) {
                    DOM.loadRemote('pako', callback);
                }
            ], function(error) {
                if (error)
                    alert(error);
                else
                    Zip.pack(value, callback);
            });
        }
        
        function sha(callback) {
            var dir             = CloudCmd.LIBDIR,
                url             = dir + 'sha/jsSHA.js';
            
            DOM.load.js(url, function() {
                var shaObj, hash, error,
                    value   = Ace.getValue();
                
                error = exec.try(function() {
                    shaObj  = new window.jsSHA(value, 'TEXT');
                    hash    = shaObj.getHash('SHA-1', 'HEX');
                });
                
                callback(error, hash);
            });
        }
        
        function setJsHintConfig(callback) {
            var JSHINT_PATH = CloudCmd.PREFIX + '/.jshintrc',
                func        = function() {
                    var worker  = Session.$worker;
                    
                    if (worker)
                        worker.send('changeOptions', [JSHintConfig]);
                    
                    exec(callback);
                };
            
            exec.if(JSHintConfig, func, function() {
                DOM.load.ajax({
                    url     :  JSHINT_PATH,
                    success : function(data) {
                        exec.try(function() {
                            JSHintConfig = JSON.parse(data);
                        });
                        
                        func();
                    }
                });
            });
        }
        
        function setMenu() {
            if (!Menu) {
                DOM.loadMenu(function(error) {
                    var position    = CloudCmd.MousePosition,
                        options     = {
                            beforeShow: function(params) {
                                params.x -= 18;
                                params.y -= 27;
                            },
                            afterClick: function() {
                                Ace.focus();
                            }
                    },
                    menuData    = {
                        'Save           Ctrl+S' : function() {
                            Edit.save();
                        },
                        'Go To Line     Ctrl+G' : function() {
                            Edit.goToLine();
                        },
                        'Select All     Ctrl+A' : function() {
                            Ace.selectAll();
                        },
                        'Delete         Del'    : function() {
                            Ace.remove('right');
                        },
                        'Beautify       Ctrl+B' : function() {
                            Edit.beautify();
                        },
                        'Minify         Ctrl+M' : function() {
                            Edit.minify();
                        },
                        'Close          Esc'    : Edit.hide
                    };
                    
                    if (error) {
                        Dialog.alert(error);
                    } else if (!Menu) {
                        Menu        = new MenuIO(Element, options, menuData);
                        Menu.show(position.x, position.y);
                        
                        Events.remove('contextMenu', Element, setMenu);
                    }
                });
            }
        }
        
        function loadFiles(callback) {
            var url     = join([
                    'theme-tomorrow_night_blue',
                    'ext-language_tools',
                    'ext-searchbox',
                    'ext-modelist'
                ].map(function(name) {
                    return DIR + name + '.js';
                }));
            
            Util.time(Name + ' load');
            
            DOM.loadRemote('ace', function() {
                DOM.load.js(url, function() {
                    Loading = false;
                    
                    Util.timeEnd(Name + ' load');
                    exec(callback);
                });
                
                DOM.load.style({
                    id      : 'msg-css',
                    inner   : '#js-view .msg {'     +
                                'z-index'           + ': 1;'                    +
                                'background-color'  + ': #7285B7;'              +
                                'color'             + ': #D1F1A9;'              +
                                'position'          + ': fixed;'                +
                                'left'              + ': 40%;'                  +
                                'top'               + ': 25px;'                 +
                                'padding'           + ': 5px;'                  +
                                'opacity'           + ': 0.9;'                  +
                                'transition'        + ': ease 0.5s;'            +
                            '}'
                });
            });
        }
        
        function onSave(text) {
            var ret,
                size    = Format.size(Value.length),
                isError = /^error/.test(text),
                msg     = '\nShould I save file anyway?';
                
            if (!isError) {
                Edit.showMessage(text);
                
                sha(function(error, hash) {
                    if (error)
                        console.error(error);
                    
                    DOM.saveDataToStorage(FileName, Value, hash);
                });
                
                DOM.setCurrentSize(size);
            } else {
                ret     = Dialog.confirm(text + msg);
                
                if (ret)
                    RESTful.write(FileName, Value, onSave);
            }
        }
        
        Edit.beautify = function() {
           readWithFlag('beautify');
        };
        
        Edit.minify = function() {
            readWithFlag('minify');
        };
        
        function readWithFlag(flag) {
            var path = FileName;
            
            Util.check(arguments, ['flag']);
            
            RESTful.read(path + '?' + flag, function(data) {
                Ace.setValue(data);
                Ace.clearSelection();
                Ace.moveCursorTo(0, 0);
            });
        }
        
        function onDrop(event) {
            var reader, files,
                onLoad   =  function(event) {
                    var data    = event.target.result;
                    
                    Ace.setValue(data);
                };
            
            event.preventDefault();
            
            files   = event.dataTransfer.files;
            
            [].forEach.call(files, function(file) {
                reader  = new FileReader();
                Events.addLoad(reader, onLoad);
                reader.readAsBinaryString(file);
            });
        }
        
        this.showMessage    = function(text) {
            var msg, HIDE_TIME = 2000;
            
            /* 
             * Msg should be created and removed
             * if it's not and just inner text
             * is changing, and hide and show of DOM
             * is called - bug occures: empty box
             * with no text inside.
             */
            msg = DOM.load({
                name        : 'div',
                className   : 'msg',
                parent      : Element,
                inner       : text,
                func        : alert
            });
            
            setTimeout(function() {
                DOM.remove(msg, Element);
            }, HIDE_TIME);
        };
        
        init(callback);
    }
    
})(CloudCmd, Util, DOM, CloudFunc);
