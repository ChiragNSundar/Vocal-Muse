import os
import sys

os.makedirs('graphify-out', exist_ok=True)
with open('graphify-out/.graphify_python', 'w', encoding='utf-8') as f:
    f.write(sys.executable)
with open('graphify-out/.graphify_root', 'w', encoding='utf-8') as f:
    f.write(os.path.abspath('.'))
print('Graphify init successful')
