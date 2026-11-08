package main

import "strings"

// flags that take no value.
var boolFlags = map[string]bool{
	"a": true, "audio": true,
	"l": true, "list-formats": true,
	"json": true, "no-history": true,
	"version": true, "h": true, "help": true,
	"force": true,
}

// flags that take the next argument as their value.
var valueFlags = map[string]bool{
	"f": true, "format": true,
	"q": true, "quality": true,
	"o": true, "output": true,
	"proxy": true, "cookies": true,
	"timeout": true, "only": true, "mirror": true,
}

// splitArgs 把夹在链接后面的选项挪到前面。
//
// 标准库 flag 遇到第一个非选项就停止，而用户习惯写
// `downvid <url> -q 1080`；这里先分拣，再交给 flag。
func splitArgs(args []string) []string {
	var flags, positional []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--" {
			positional = append(positional, args[i+1:]...)
			break
		}
		if a == "-" || !strings.HasPrefix(a, "-") {
			positional = append(positional, a)
			continue
		}

		flags = append(flags, a)
		name := strings.TrimLeft(a, "-")
		if strings.ContainsRune(name, '=') {
			continue
		}
		if valueFlags[name] && i+1 < len(args) {
			i++
			flags = append(flags, args[i])
		}
	}
	return append(flags, positional...)
}
