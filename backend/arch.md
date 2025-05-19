**Module should have the following**

1. Set of commands that can be executed. Each command can return 
   1. A bunch of text
   2. A Json

2. Ability to store a set of lists which can be used to 


fs.list - list a set of files
Return Json
    display: text to show on the screen
    store : an array of item to store
       each item is a json object
         type : file, dir, link
         value : the value of the file, dir, link

fs.list
```
1. File 1
2. File 2
3. Fil3 3
```

im.display 2

im.detail 2

exec()


A python script is executed as

exec(python_script, {}, {history:[result]})