"""One-time migration of existing server messages into the shared editable text file."""
import json,pathlib,re
root=pathlib.Path(__file__).resolve().parents[1]
p=root/'server/core.mjs'
code=p.read_text()
pattern=re.compile(r"'([^'\n]*(?:\\.[^'\n]*)*)'")
messages={}
def replace(match):
    value=match.group(1)
    if not re.search('[А-Яа-яЁё]',value):return match.group(0)
    if value not in messages:messages[value]=f'message_{len(messages)+1:02}'
    return 'RU.server.'+messages[value]
code=pattern.sub(replace,code)
if messages:
    code="import {RU} from '../web/content/ru.js';\n"+code
    p.write_text(code)
    t=root/'web/content/ru.js';text=t.read_text()
    replacement='server: {\n'+',\n'.join('    '+k+': '+json.dumps(v,ensure_ascii=False) for v,k in messages.items())+'\n  }'
    assert 'server: {}' in text
    t.write_text(text.replace('server: {}',replacement))
print('Centralized',len(messages),'server messages')
