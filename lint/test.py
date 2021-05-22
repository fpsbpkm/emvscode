import sys

_ERROR_CATEGORIES = [
    'whitespace/line_length',
]

_line_length = 80

# cpplintの例
# test.c:4: warning: Lines should be <= 80 characters long  [whitespace/line_length] [2]
def Error(filename, linenum, category, confidence, message):
    sys.stderr.write(f"{filename}:{linenum}: warning: {message} [{category}] [{confidence}]\n")


def CheckStyle(filename, linenum, contents):
    linewidth = len(contents)
    if linewidth > _line_length:
        Error(filename, linenum, 'whitespace/line_length', 2,
            'Lines should be <= %i characters long' % _line_length)


def ProcessFileData(filename):
    linenum = 0
    with open(filename, 'rt') as f:
        while True:
            contents = f.readline()
            if not contents:
                break
            linenum += 1
            CheckStyle(filename, linenum, contents)    
    

def main():
    filename = sys.argv[1]
    ProcessFileData(filename)


if __name__ == '__main__':
    main()
