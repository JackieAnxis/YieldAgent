#!/bin/bash
# 示例：用 yield 实现交互式问答

echo "=== 开始 ==="

name=$(yield "你好！你叫什么名字？")
echo "收到名字: $name"

hobby=$(yield "你喜欢做什么？")
echo "收到爱好: $hobby"

echo "总结: $name 喜欢 $hobby，记住了！"
