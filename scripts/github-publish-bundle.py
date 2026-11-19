"""Prepare only reviewable source and selected CC0 clips; never include records/secrets."""
import base64,hashlib,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[1]
if len(sys.argv)>1 and sys.argv[1]=='chunk':
    relative=sys.argv[2];target=(root/relative).resolve()
    assert target.is_relative_to(root) and not any(x in relative.split('/') for x in ['private','results','.git','.env','.openai'])
    encoded=base64.b64encode(target.read_bytes()).decode('ascii')
    print(encoded[int(sys.argv[3]):int(sys.argv[3])+6000]);raise SystemExit
files=[]
for name in ['index.html','.nojekyll','.gitignore','.dockerignore','.env.example','package.json','README.md','Dockerfile','Запустить эксперимент.command']:
    if (root/name).is_file():files.append(root/name)
for directory in ['web','server','scripts','tests','docs']:
    files.extend(p for p in (root/directory).rglob('*') if p.is_file() and p.name!='.DS_Store' and '__pycache__' not in p.parts and p.name!='demo.mp4')
entries=[]
for p in sorted(set(files)):
    data=p.read_bytes();relative=p.relative_to(root).as_posix()
    assert not any(x in p.relative_to(root).parts for x in ['private','results','.git','.openai'])
    entries.append(dict(path=relative,size=len(data),encoded_length=4*((len(data)+2)//3),sha256=hashlib.sha256(data).hexdigest(),mode='100755' if p.suffix=='.command' else '100644'))
out=root/'private/github-publish-list.json';out.write_text(json.dumps(entries,ensure_ascii=False,indent=2))
print(json.dumps(entries,ensure_ascii=False))
