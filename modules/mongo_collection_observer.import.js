import {EventEmitter} from 'angular2/angular2';

class CursorHandle {
  _cursor: Mongo.Cursor<any>;
  _hAutoNotify: Tracker.Computation;
  _hCurObserver: Object;

  constructor(cursor: Mongo.Cursor<any>,
    hAutoNotify: Tracker.Computation,
    hCurObserver: Object) {
    check(cursor, Mongo.Cursor);
    check(hAutoNotify, Tracker.Computation);
    check(hCurObserver, Match.Where(function(observer) {
      return !!observer.stop;
    }));

    this._cursor = cursor;
    this._hAutoNotify = hAutoNotify;
    this._hCurObserver = hCurObserver;
  }

  stop() {
    this._hAutoNotify.stop();
    this._hCurObserver.stop();
  }
}

export class AddChange {
  constructor(index: number, item: any) {
    check(index, Number);

    this.index = index;
    this.item = item;
  }
}

export class MoveChange {
  constructor(fromIndex: number, toIndex: number) {
    check(fromIndex, Number);
    check(toIndex, Number);

    this.fromIndex = fromIndex;
    this.toIndex = toIndex;
  }
}

export class RemoveChange {
  constructor(index: number) {
    check(index, Number);

    this.index = index;
  }
}

export class MongoCollectionObserver extends EventEmitter {
  _docs: Array<any>;
  _changes: Array<any>;
  _lastChanges: Array<any>;
  _cursorDefFunc: Function;
  _hCursor: CursorHandle;
  _propMap: Map<String, Object>;
  _eventMap: Map<String, Array<Function>>;

  constructor(cursorDefFunc) {
    check(cursorDefFunc, Function);

    super();
    this._docs = [];
    this._changes = [];
    this._lastChanges = [];
    this._propMap = new Map();
    this._eventMap = new Map();
    this._cursorDefFunc = cursorDefFunc;
  
    this._defineGets(cursorDefFunc);
    this._startAutoCursorUpdate(cursorDefFunc); 
  }

  get lastChanges() {
    return this._lastChanges;
  }

  _defineGets(cursorDefFunc) {
    cursorDefFunc.call(this);
  }

  get(propName: String): any {
    check(propName, String);

    if (!this._propMap.get(propName)) {
      var depVar = new Tracker.Dependency();
      this._propMap.set(propName, {
        depVar: depVar,
        value: this[propName]
      });
      var self = this;
      Object.defineProperty(this, propName, {
          get: function() {
            return self._propMap.get(propName).value;
          },
          set: function(value) {
            self._propMap.get(propName).value = value;
            self._propMap.get(propName).depVar.changed();
          },
          enumerable: true,
          configurable: true
      });
    }
    this._propMap.get(propName).depVar.depend();
    return this[propName];
  }

  on(eventName, callback) {
    check(eventName, String);
    check(callback, Function);

    if (!this._eventMap.has(eventName)) {
      this._eventMap.set(eventName, []);
    }
    this._eventMap.get(eventName).push(callback);
  }

  _raise(eventName) {
    check(eventName, String);

    if (this._eventMap.has(eventName)) {
      var callbacks = this._eventMap.get(eventName);
      for (let callback of callbacks) {
        callback();
      }
    }
  }

  _startAutoCursorUpdate(cursorDefFunc) {
    var self = this;
    Tracker.autorun(zone.bind(() => {
      if (self._hCursor) {
        self._stopCursor(self._hCursor);
        self._hCursor = null;
      }
      self._hCursor = self._startCursor(cursorDefFunc.call(self));
      self._raise('newCursor');
    }));
  }

  _stopCursor(cursorHandle: CursorHandle) {
    cursorHandle.stop();
    var len = this._docs.length;
    this._docs.length = 0;
    for (var i = 0; i < len; i++) {
      this._changes.push(new RemoveChange(i));
    }
  }

  _startCursor(cursor: Mongo.Cursor<any>) {
    var hCurObserver = this._startCursorObserver(cursor);
    var hAutoNotify = this._startAutoChangesNotify(cursor);
    return new CursorHandle(cursor, hAutoNotify, hCurObserver);
  }

  _startAutoChangesNotify(cursor: Mongo.Cursor<any>) {
    var self = this;
    return Tracker.autorun(zone.bind(() => {
      cursor.fetch();
      var lastChanges = self._changes.splice(0);
      if (lastChanges.length) {
        self.next(lastChanges);
      }
      self._lastChanges = lastChanges;
    }));
  }

  _startCursorObserver(cursor: Mongo.Cursor<any>) {
    var self = this;
    return cursor.observe({
      addedAt: function(doc, index) {
        self._addAt(doc, index);
      },

      changedAt: function(nDoc, oDoc, index) {
        var doc = self._docs[index];
        if (doc._id === nDoc._id) {
          Object.assign(self._docs[index], nDoc);
        } else {
          self._docs[index] = nDoc;
        }
      },

      movedTo: function(doc, fromIndex, toIndex) {
        self._moveTo(doc, fromIndex, toIndex);
      },

      removedAt: function(doc, atIndex) {
        self._removeAt(atIndex);
      }
    });
  }

  _addAt(doc, index) {
    this._docs.splice(index, 0, doc);
    this._changes.push(new AddChange(index, doc));
  }

  _moveTo(doc, fromIndex, toIndex) {
    this._docs.splice(fromIndex, 1);
    this._docs.splice(toIndex, 0, doc);
    this._changes.push(new MoveChange(fromIndex, toIndex));
  }

  _removeAt(index) {
    this._docs.splice(index, 1);
    this._changes.push(new RemoveChange(index));
  }

  destroy() {
    if (this._hCursor) {
      this._hCursor.stop();
    }
    this._propMap.clear();
    this._eventMap.clear();
    this._docs.length = 0;
    this._changes.length = 0;

    this._hCursor = null;
    this._propMap = null;
    this._eventMap = null;
    this._docs = null;
    this._changes = null;
  }
}
