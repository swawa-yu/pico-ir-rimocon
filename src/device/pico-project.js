(() => {
  'use strict';
  const paths=['main.py','parts.py','lib/pico_parts.py'];
  function payload(files){
    if(paths.some(p=>typeof files[p]!=='string')||Object.entries(files).some(([p,text])=>!(/^(?:[A-Za-z_]\w*\/)*[A-Za-z_]\w*\.py$/.test(p)&&!p.split('/').includes('__pycache__'))||typeof text!=='string'))throw Error('生成ファイルが不足しています。');
    const encoded={};
    for(const path of Object.keys(files)){
      const bytes=new TextEncoder().encode(files[path]);
      encoded[path]=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
    }
    return `import os, json, ubinascii\nos.chdir('/')\n_files = json.loads(${JSON.stringify(JSON.stringify(encoded))})\n`;
  }
  const common=`
def _exists(path):
  try:
    os.stat(path)
    return True
  except OSError as error:
    if error.args[0] == 2:
      return False
    raise

def _check_parent(path):
  parts = path.split('/')[:-1]
  for i in range(1, len(parts) + 1):
    parent = '/'.join(parts[:i])
    if _exists(parent) and not os.stat(parent)[0] & 0x4000:
      raise ValueError(parent + ' is a file, not a directory')

def _inspect():
  result = []
  if _exists('lib') and not os.stat('lib')[0] & 0x4000:
    raise ValueError('lib is a file, not a directory')
  for path, encoded in _files.items():
    _check_parent(path)
    expected = ubinascii.a2b_base64(encoded)
    compile(expected.decode('utf-8'), path, 'exec')
    exists = _exists(path)
    size = os.stat(path)[6] if exists else 0
    if exists and os.stat(path)[0] & 0x4000:
      raise ValueError(path + ' is a directory')
    same = False
    if exists and size == len(expected):
      with open(path, 'rb') as stream:
        same = stream.read() == expected
    result.append({'path': path, 'size': size, 'exists': exists, 'same': same})
  return result
`;
  function bounded(source){if(new TextEncoder().encode(source).length>32768)throw Error('転送処理が32KBを超えます。ブロックを減らしてください。');return source;}
  function inspect(files){return bounded(payload(files)+common+`\nprint(json.dumps(_inspect()))\n`);}
  const install=`
_cleanup_errors = []
if _changes:
  _saved = []
  _installed = []
  try:
    for _index, _entry in enumerate(_changes):
      _path = _entry['path']
      _parts = _path.split('/')[:-1]
      for _depth in range(1, len(_parts) + 1):
        _parent = '/'.join(_parts[:_depth])
        if not _exists(_parent):
          os.mkdir(_parent)
      if _entry['exists']:
        os.rename(_path, _root + '/backup-' + str(_index))
        _saved.append((_index, _path))
      os.rename(_entry['stage'], _path)
      _installed.append(_path)
  except BaseException:
    _rollback_errors = []
    for _path in reversed(_installed):
      try:
        os.remove(_path)
      except OSError:
        _rollback_errors.append(_path)
    for _index, _path in reversed(_saved):
      try:
        os.rename(_root + '/backup-' + str(_index), _path)
      except OSError:
        _rollback_errors.append(_path)
    if _rollback_errors:
      raise OSError('restore files from ' + _root + ': ' + ', '.join(_rollback_errors))
    raise
  with open(_root + '/complete', 'w') as _stream:
    _stream.write('pico-studio-v1')
  for _old in os.listdir('.'):
    if _old == _root or not _old.startswith('.pico-studio-') or not _old[13:].isdigit():
      continue
    try:
      if not os.stat(_old)[0] & 0x4000 or not _exists(_old + '/complete'):
        continue
      with open(_old + '/complete') as _stream:
        if _stream.read() != 'pico-studio-v1':
          continue
      with open(_old + '/manifest.json') as _stream:
        _manifest = json.loads(_stream.read())
      if not isinstance(_manifest, list):
        continue
      _allowed = ['manifest.json', 'complete'] + ['backup-' + str(i) for i in range(len(_manifest))]
      _names = os.listdir(_old)
      if any(name not in _allowed or os.stat(_old + '/' + name)[0] & 0x4000 for name in _names):
        continue
      for _name in _names:
        if _name != 'complete':
          os.remove(_old + '/' + _name)
      os.remove(_old + '/complete')
      os.rmdir(_old)
    except (OSError, ValueError):
      _cleanup_errors.append(_old)
print(json.dumps({'backup': _root, 'changed': len(_changes), 'cleanupErrors': _cleanup_errors}))
`;
  function transfer(files){return bounded(payload(files)+common+`
_changes = [entry for entry in _inspect() if not entry['same']]
_root = None
if _changes:
  _number = 0
  while _exists('.pico-studio-' + str(_number)):
    _number += 1
  _root = '.pico-studio-' + str(_number)
  os.mkdir(_root)
  with open(_root + '/manifest.json', 'w') as _stream:
    _stream.write(json.dumps(_changes))
  for _index, _entry in enumerate(_changes):
    _data = ubinascii.a2b_base64(_files[_entry['path']])
    _entry['stage'] = _root + '/stage-' + str(_index)
    with open(_entry['stage'], 'wb') as _stream:
      _stream.write(_data)
    with open(_entry['stage'], 'rb') as _stream:
      if _stream.read() != _data:
        raise OSError('write verification failed')
`+install);}
  function scoped(source){return `import gc as _studio_gc
_studio_gc.collect()
def _studio_fileop():
${source.trim().split('\n').map(line=>' '+line).join('\n')}
try:
 _studio_fileop()
finally:
 del _studio_fileop
 _studio_gc.collect()
`;}
  const prepare=`import sys as _studio_sys, gc as _studio_gc
if 'pico_parts' in _studio_sys.modules:
 _studio_sys.modules['pico_parts'].close()
for _studio_key in ('_studio_namespace', '_console_code', '_console_value', '_files', '_data', '_expected', '_response', '_inspect', '_exists'):
 globals().pop(_studio_key, None)
for _studio_key in ('parts', 'pico_parts', 'ssd1306'):
 _studio_sys.modules.pop(_studio_key, None)
for _studio_key in list(_studio_sys.modules):
 if any(_studio_key == name or _studio_key.startswith(name + '.') for name in globals().get('_studio_project_modules', [])):
  if getattr(_studio_sys.modules[_studio_key], '__file__', None):
   _studio_sys.modules.pop(_studio_key, None)
del _studio_key
_studio_gc.collect()
`;
  async function upload(device,files){
    payload(files);
    const entries=Object.entries(files).map(([path,text])=>({path,size:new TextEncoder().encode(text).length}));
    const exists=common.slice(0,common.indexOf('def _inspect():'));
    let phase='書き込みの準備';
    try{
      await device.exec(prepare);
      const begin=scoped(`import os, json
os.chdir('/')
${exists}
_entries = json.loads(${JSON.stringify(JSON.stringify(entries))})
if _exists('lib') and not os.stat('lib')[0] & 0x4000:
 raise ValueError('lib is a file, not a directory')
for _entry in _entries:
 _check_parent(_entry['path'])
 if _exists(_entry['path']) and os.stat(_entry['path'])[0] & 0x4000:
  raise ValueError(_entry['path'] + ' is a directory')
def _remove_cache(path):
 for _name in os.listdir(path):
  _child = path + '/' + _name
  if os.stat(_child)[0] & 0x4000:
   _remove_cache(_child)
  else:
   os.remove(_child)
 os.rmdir(path)
for _base in ('.', 'lib'):
 if _exists(_base) and os.stat(_base)[0] & 0x4000:
  for _cache in ('__pycache__', '.mypy_cache'):
   _path = _base + '/' + _cache
   if _exists(_path) and os.stat(_path)[0] & 0x4000:
    _remove_cache(_path)
_number = 0
while _exists('.pico-studio-' + str(_number)):
 _number += 1
_root = '.pico-studio-' + str(_number)
os.mkdir(_root)
with open(_root + '/manifest.json', 'w') as _stream:
 _stream.write(json.dumps(_entries))
print(json.dumps({'root': _root}))
`);
      const {root}=JSON.parse((await device.exec(begin)).trim());
      if(typeof root!=='string'||!/^\.pico-studio-[0-9]+$/.test(root))throw Error('Picoの退避先を確認できません。');
      for(let index=0;index<entries.length;index++){
        const entry=entries[index],bytes=new TextEncoder().encode(files[entry.path]);
        phase=entry.path+' の書き込み';
        // A 1 KiB payload avoids compiling a single project-sized string on Pico.
        for(let offset=0;offset<bytes.length||offset===0;offset+=1024){
          const chunk=btoa(Array.from(bytes.slice(offset,offset+1024),b=>String.fromCharCode(b)).join(''));
          await device.exec(scoped(`import os, ubinascii
os.chdir('/')
_path = ${JSON.stringify(root+'/stage-'+index)}
_data = ubinascii.a2b_base64(${JSON.stringify(chunk)})
if ${offset} and os.stat(_path)[6] != ${offset}:
 raise OSError('staging offset mismatch')
with open(_path, '${offset?'ab':'wb'}') as _stream:
 if _stream.write(_data) != len(_data):
  raise OSError('short write')
with open(_path, 'rb') as _stream:
 _stream.seek(${offset})
 if _stream.read(len(_data)) != _data:
  raise OSError('write verification failed')
`));
        }
      }
      phase='書き込みの確定';
      const finish=scoped(`import os, json, gc
os.chdir('/')
${exists}
_root = ${JSON.stringify(root)}
_entries = json.loads(${JSON.stringify(JSON.stringify(entries))})
_changes = []
for _index, _entry in enumerate(_entries):
 _path = _entry['path']
 _stage = _root + '/stage-' + str(_index)
 if os.stat(_stage)[6] != _entry['size']:
  raise OSError('incomplete staging: ' + _path)
 with open(_stage) as _stream:
  _source = _stream.read()
 compile(_source, _path, 'exec')
 del _source
 gc.collect()
 _exists_now = _exists(_path)
 _size = os.stat(_path)[6] if _exists_now else 0
 _same = _exists_now and _size == _entry['size']
 if _same:
  with open(_stage, 'rb') as _left, open(_path, 'rb') as _right:
   while True:
    _chunk = _left.read(1024)
    if _chunk != _right.read(1024):
     _same = False
     break
    if not _chunk:
     break
 if _same:
  os.remove(_stage)
 else:
  _changes.append({'path': _path, 'size': _size, 'exists': _exists_now, 'same': False, 'stage': _stage})
if _changes:
 with open(_root + '/manifest.json', 'w') as _stream:
  _stream.write(json.dumps(_changes))
else:
 os.remove(_root + '/manifest.json')
 os.rmdir(_root)
 _root = None
${install}
`);
      return JSON.parse((await device.exec(finish)).trim());
    }catch(error){throw Error(phase+': '+error.message);}
  }
  const launch=`import sys, os, gc
globals().pop('_studio_namespace', None)
globals().pop('_console_code', None)
globals().pop('_console_value', None)
os.chdir('/')
if '/lib' not in sys.path:
  sys.path.append('/lib')
for _name in ('parts', 'pico_parts', 'ssd1306'):
  if _name in sys.modules:
    del sys.modules[_name]
gc.collect()
import pico_parts
_studio_namespace = {'__name__': '__main__'}
try:
  with open('main.py') as _program:
    exec(_program.read(), _studio_namespace)
finally:
  pico_parts.close()
`;
  function launchFor(files){
    payload(files);
    const modules=Object.keys(files).filter(path=>path!=='main.py').map(path=>path.replace(/^lib\//,'').replace(/\.py$/,'').replace(/\/__init__$/,'').replaceAll('/','.'));
    return `import sys as _studio_sys\nfor _studio_key in list(_studio_sys.modules):\n if any(_studio_key == name or _studio_key.startswith(name + '.') for name in ${JSON.stringify(modules)} + globals().get('_studio_project_modules', [])):\n  if getattr(_studio_sys.modules[_studio_key], '__file__', None):\n   _studio_sys.modules.pop(_studio_key, None)\n_studio_project_modules = ${JSON.stringify(modules)}\n`+launch;
  }
  function launchStepped(files,prepared,token){
    const hook=prepared.hook,enabled=hook+'_enabled';
    const helper=`import sys\n${enabled} = True\ndef ${hook}(line):\n global ${enabled}\n if not ${enabled}:\n  return\n sys.stdout.write('\\x1ePICO_STEP:${token}:' + str(line) + '\\x1f')\n try:\n  command = input()\n  if command == '!continue:${token}':\n   ${enabled} = False\n except KeyboardInterrupt:\n  ${enabled} = False\n  raise\n`;
    const source=helper+launchFor(files)
      .replace("_studio_namespace = {'__name__': '__main__'}",`_studio_namespace = {'__name__': '__main__', '${hook}': ${hook}}`)
      .replace("  with open('main.py') as _program:\n    exec(_program.read(), _studio_namespace)",`  exec(compile(${JSON.stringify(prepared.code)}, 'main.py', 'exec'), _studio_namespace)`)
      .replace('finally:\n  pico_parts.close()',`finally:\n  try:\n    pico_parts.close()\n  finally:\n    _studio_namespace['${hook}'] = lambda line: None\n    globals().pop('${hook}', None)\n    globals().pop('${enabled}', None)\n`);
    if(new TextEncoder().encode(source).length>32768)throw Error('1行実行のコードが32KBを超えます。main.pyを小さくしてください。');
    return source;
  }
  function safePath(path){
    if(typeof path!=='string'||path.includes('\0')||path.startsWith('/')||path.split('/').some(p=>p==='.'||p==='..'||(!p&&path!=='')))throw Error('ファイル名が不正です。');
    return path;
  }
  function directory(path,files){
    safePath(path);
    const expected={};
    for(const [name,text] of Object.entries(files))if(name.slice(0,name.lastIndexOf('/')+1)===(path?path+'/':''))expected[name.split('/').pop()]=btoa(Array.from(new TextEncoder().encode(text),b=>String.fromCharCode(b)).join(''));
    return bounded(`import os, json, ubinascii
_directory = json.loads(${JSON.stringify(JSON.stringify('/'+path))})
_expected = json.loads(${JSON.stringify(JSON.stringify(expected))})
_entries = []
try:
 _names = os.listdir(_directory)
except OSError as _error:
 if _error.args[0] != 2:
  raise
 _names = []
for _name in sorted(_names):
 _path = _directory.rstrip('/') + '/' + _name
 _stat = os.stat(_path)
 _dir = bool(_stat[0] & 0x4000)
 _same = None
 if not _dir and _name in _expected:
  _data = ubinascii.a2b_base64(_expected[_name])
  _same = False
  if _stat[6] == len(_data):
   with open(_path, 'rb') as _stream:
    _same = _stream.read(len(_data) + 1) == _data
 _entries.append({'name': _name, 'dir': _dir, 'size': _stat[6], 'same': _same})
_response = json.dumps(_entries)
if len(_response.encode()) > 60000:
 raise ValueError('Directory listing exceeds USB response buffer')
print(_response)
`);
  }
  function read(path){
    safePath(path);if(!path)throw Error('ファイルを選んでください。');
    // Base64 keeps a 32 KiB file below the REPL's 64 KiB response buffer even for control characters.
    return `import json, ubinascii
with open(json.loads(${JSON.stringify(JSON.stringify('/'+path))}), 'rb') as _stream:
 _data = _stream.read(32769)
if len(_data) > 32768:
 raise ValueError('File exceeds 32 KiB')
print(json.dumps({'data': ubinascii.b2a_base64(_data).decode().strip()}))
`;
  }
  const api={inspect,transfer,upload,launch,launchFor,launchStepped,paths,directory,read};
  if(typeof module!=='undefined')module.exports=api;
  if(typeof window!=='undefined')window.PicoProject=api;
})();
