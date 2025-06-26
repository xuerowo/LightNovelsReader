#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
自動更新 GitHub 儲存庫腳本
雙擊運行此腳本以自動更新當前儲存庫
"""

import subprocess
import os
import sys
from pathlib import Path

def print_colored(text, color_code):
    """輸出彩色文字"""
    print(f"\033[{color_code}m{text}\033[0m")

def print_success(text):
    """輸出成功訊息（綠色）"""
    print_colored(f"✓ {text}", "92")

def print_error(text):
    """輸出錯誤訊息（紅色）"""
    print_colored(f"✗ {text}", "91")

def print_info(text):
    """輸出資訊訊息（藍色）"""
    print_colored(f"ℹ {text}", "94")

def print_warning(text):
    """輸出警告訊息（黃色）"""
    print_colored(f"⚠ {text}", "93")

def run_git_command(command):
    """執行 Git 命令並返回結果"""
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding='utf-8'
        )
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def check_git_repo():
    """檢查當前目錄是否為 Git 儲存庫"""
    if not os.path.exists(".git"):
        print_error("當前目錄不是 Git 儲存庫")
        return False
    return True

def check_git_status():
    """檢查 Git 狀態，返回 (has_changes, changes_output)"""
    success, stdout, stderr = run_git_command("git status --porcelain")
    if not success:
        print_error(f"檢查 Git 狀態失敗: {stderr}")
        return None, None
    
    return bool(stdout.strip()), stdout


def stash_changes():
    """暫存當前更改"""
    print_info("正在暫存未提交的更改...")
    success, stdout, stderr = run_git_command("git stash push -m 'auto_update_script_stash'")
    if not success:
        print_error(f"暫存更改失敗: {stderr}")
        return False
    print_success("更改已暫存")
    return True

def restore_stashed_changes():
    """恢復暫存的更改"""
    print_info("正在恢復暫存的更改...")
    success, stdout, stderr = run_git_command("git stash pop")
    if not success:
        print_warning(f"恢復暫存更改時出現問題: {stderr}")
        print_info("您可以稍後使用 'git stash pop' 命令手動恢復")
        return False
    print_success("暫存的更改已恢復")
    return True

def update_repository():
    """更新儲存庫"""
    print_info("開始更新儲存庫...")
    
    # 檢查是否為 Git 儲存庫
    if not check_git_repo():
        return False
    
    # 獲取當前分支
    success, current_branch, stderr = run_git_command("git branch --show-current")
    if not success:
        print_error(f"無法獲取當前分支: {stderr}")
        return False
    
    current_branch = current_branch.strip()
    print_info(f"當前分支: {current_branch}")
    
    # 檢查工作目錄狀態
    has_changes, changes_output = check_git_status()
    if has_changes is None:
        return False
    
    stashed = False
    if has_changes:
        print_info("檢測到未提交的更改，自動暫存中...")
        print("未提交的檔案:")
        print(changes_output)
        
        if not stash_changes():
            return False
        stashed = True
    
    try:
        # 獲取遠端更新
        print_info("正在獲取遠端更新...")
        success, stdout, stderr = run_git_command("git fetch")
        if not success:
            print_error(f"獲取遠端更新失敗: {stderr}")
            return False
        
        # 檢查是否有新的提交
        success, stdout, stderr = run_git_command(f"git log HEAD..origin/{current_branch} --oneline")
        if not success:
            print_error(f"檢查遠端提交失敗: {stderr}")
            return False
        
        if not stdout.strip():
            print_success("儲存庫已是最新版本")
            return True
        
        # 顯示即將更新的提交
        print_info("發現新的提交:")
        print(stdout)
        
        # 執行更新
        print_info("正在拉取更新...")
        success, stdout, stderr = run_git_command("git pull")
        if not success:
            print_error(f"更新失敗: {stderr}")
            return False
        
        print_success("儲存庫更新成功！")
        if stdout.strip():
            print("更新詳情:")
            print(stdout)
        
        return True
        
    finally:
        # 如果之前暫存了更改，現在恢復它們
        if stashed:
            restore_stashed_changes()

def main():
    """主函數"""
    print_colored("=" * 50, "96")
    print_colored("    GitHub 儲存庫自動更新工具", "96")
    print_colored("=" * 50, "96")
    print()
    
    # 顯示當前目錄
    current_dir = Path.cwd()
    print_info(f"當前目錄: {current_dir}")
    print()
    
    try:
        success = update_repository()
        print()
        
        if success:
            print_success("更新完成！")
        else:
            print_error("更新失敗！")
            
    except KeyboardInterrupt:
        print()
        print_warning("用戶中斷操作")
    except Exception as e:
        print()
        print_error(f"發生未預期的錯誤: {e}")
    
    print()
    print_colored("=" * 50, "96")
    input("按 Enter 鍵退出...")

if __name__ == "__main__":
    main()