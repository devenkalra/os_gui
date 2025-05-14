from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import os
import shutil
from typing import List, Dict, Optional, Any
from pathlib import Path
import json
import subprocess
from pydantic import BaseModel
from datetime import datetime
import signal
import psutil
import shlex
from sse_starlette.sse import EventSourceResponse
import asyncio
import threading
import queue
from fastapi.responses import StreamingResponse

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store running processes
running_processes: Dict[str, subprocess.Popen] = {}

# Store saved commands
SAVED_COMMANDS_FILE = "saved_commands.json"

# Script management
SAVED_SCRIPTS_FILE = "saved_scripts.json"

class SavedCommand(BaseModel):
    name: str
    description: str = ""  # Optional description field with default empty string
    command: str
    parameters: Optional[Dict[str, str]] = None
    options: Optional[Dict[str, bool]] = None
    sortField: Optional[str] = None
    sortDirection: Optional[str] = None
    postProcess: Optional[Dict[str, str]] = None

class Script(BaseModel):
    name: str
    description: str
    body: str

class ScriptExecution(BaseModel):
    name: str
    body: str
    args: str = ""  # Default to empty string if no args provided

def load_saved_commands() -> Dict[str, SavedCommand]:
    try:
        if os.path.exists(SAVED_COMMANDS_FILE):
            with open(SAVED_COMMANDS_FILE, 'r') as f:
                data = json.load(f)
                return {name: SavedCommand(**cmd) for name, cmd in data.items()}
    except Exception as e:
        print(f"Error loading saved commands: {e}")
    return {}

def save_commands(commands: Dict[str, SavedCommand]):
    try:
        with open(SAVED_COMMANDS_FILE, 'w') as f:
            json.dump({name: cmd.dict() for name, cmd in commands.items()}, f, indent=2)
    except Exception as e:
        print(f"Error saving commands: {e}")

# Load saved commands at startup
saved_commands = load_saved_commands()

def load_saved_scripts() -> dict:
    if os.path.exists(SAVED_SCRIPTS_FILE):
        with open(SAVED_SCRIPTS_FILE, 'r') as f:
            return json.load(f)
    return {}

def save_scripts(scripts: dict):
    with open(SAVED_SCRIPTS_FILE, 'w') as f:
        json.dump(scripts, f, indent=2)

# Load saved scripts on startup
saved_scripts = load_saved_scripts()

class FileManager:
    @staticmethod
    def validate_path(path: str) -> Optional[str]:
        """Validate path and return error message if invalid."""
        if not path or path == "/":
            return None
            
        # Check if path exists
        if not os.path.exists(path):
            return f"Path does not exist: {path}"
            
        # Check if path is accessible
        if not os.access(path, os.R_OK):
            return f"Path is not accessible: {path}"
            
        return None

    @staticmethod
    def list_directory(path: str) -> Dict:
        try:
            # If path is empty or just a slash, use current directory
            if not path or path == "/":
                path = "."
            
            # Validate path
            error = FileManager.validate_path(path)
            if error:
                return {
                    "items": [],
                    "error": error,
                    "is_valid": False
                }
                
            items = []
            for item in os.listdir(path):
                full_path = os.path.join(path, item)
                stats = os.stat(full_path)
                items.append({
                    "name": item,
                    "path": full_path,
                    "is_dir": os.path.isdir(full_path),
                    "size": stats.st_size,
                    "modified": stats.st_mtime
                })
            return {
                "items": items,
                "error": None,
                "is_valid": True
            }
        except Exception as e:
            return {
                "items": [],
                "error": str(e),
                "is_valid": False
            }

    @staticmethod
    def create_directory(path: str) -> Dict:
        try:
            os.makedirs(path, exist_ok=True)
            return {"status": "success", "message": f"Directory created: {path}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def delete_path(path: str) -> Dict:
        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            return {"status": "success", "message": f"Deleted: {path}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def rename_path(old_path: str, new_path: str) -> Dict:
        try:
            os.rename(old_path, new_path)
            return {"status": "success", "message": f"Renamed {old_path} to {new_path}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @staticmethod
    def search_files(directory: str, pattern: str) -> List[Dict]:
        try:
            results = []
            for root, _, files in os.walk(directory):
                for file in files:
                    if pattern.lower() in file.lower():
                        full_path = os.path.join(root, file)
                        stats = os.stat(full_path)
                        results.append({
                            "name": file,
                            "path": full_path,
                            "size": stats.st_size,
                            "modified": stats.st_mtime
                        })
            return results
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

class CommandRequest(BaseModel):
    command: str
    parameters: Optional[Dict[str, str]] = None
    options: Optional[Dict[str, bool]] = None
    sortField: Optional[str] = None
    sortDirection: Optional[str] = 'desc'
    postProcess: Optional[Dict[str, str]] = None
    debug: Optional[bool] = False

def parse_size(size_str: str) -> int:
    """Convert human-readable size to bytes"""
    if not size_str:
        return 0
    size_str = size_str.strip()
    try:
        # Handle percentage values
        if '%' in size_str:
            return float(size_str.replace('%', ''))
        # Handle human-readable sizes
        units = {'K': 1024, 'M': 1024**2, 'G': 1024**3, 'T': 1024**4}
        if size_str[-1] in units:
            return float(size_str[:-1]) * units[size_str[-1]]
        # Handle plain numbers
        return float(size_str)
    except ValueError:
        # If parsing fails, return the original string for comparison
        return size_str

# API Routes
@app.get("/api/files/list/{path:path}")
async def list_directory(path: str):
    return FileManager.list_directory(path)

@app.post("/api/files/create-dir/{path:path}")
async def create_directory(path: str):
    return FileManager.create_directory(path)

@app.delete("/api/files/delete/{path:path}")
async def delete_path(path: str):
    return FileManager.delete_path(path)

@app.post("/api/files/rename")
async def rename_path(old_path: str, new_path: str):
    return FileManager.rename_path(old_path, new_path)

@app.get("/api/files/search")
async def search_files(directory: str, pattern: str):
    return FileManager.search_files(directory, pattern)

@app.post("/api/fs/command")
async def execute_fs_command(request: CommandRequest):
    try:
        if not request.command:
            raise HTTPException(status_code=400, detail="Command is required")

        # Generate a unique ID for this command
        command_id = f"{request.command}_{datetime.now().timestamp()}"

        # Build command arguments
        args = [request.command]
        
        # Add options
        if request.options:
            if request.command == 'df' and request.options.get('human', True):
                args.append('-h')
            elif request.command == 'du':
                if request.options.get('human', True):
                    args.append('-h')
                if request.options.get('maxdepth', True):
                    args.append('--max-depth')
                    args.append('1')
        
        # Add parameters
        if request.parameters:
            if request.command == 'df':
                # df doesn't need path parameter
                pass
            elif request.command == 'du':
                if 'path' in request.parameters:
                    args.append(request.parameters['path'])
                if 'depth' in request.parameters:
                    args.append('--max-depth')
                    args.append(request.parameters['depth'])
            elif request.command == 'find':
                if 'path' in request.parameters:
                    args.append(request.parameters['path'])
                if 'name' in request.parameters:
                    args.append('-name')
                    args.append(request.parameters['name'])
                if 'type' in request.parameters:
                    args.append('-type')
                    args.append(request.parameters['type'])

        # Print the full command being executed
        full_command = ' '.join(args)
        print(f"\nExecuting command: {full_command}")
        if request.postProcess:
            print(f"Post-processing: {request.postProcess}")

        # Execute command with process group
        process = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            preexec_fn=os.setsid  # Create new process group
        )
        
        # Store the process
        running_processes[command_id] = process

        try:
            # Wait for the process to complete
            stdout, stderr = process.communicate()
            
            if process.returncode != 0:
                error_detail = stderr.strip() if stderr else "Command failed with no error message"
                print(f"Command failed with return code {process.returncode}")
                print(f"Error: {error_detail}")
                raise HTTPException(
                    status_code=500,
                    detail={
                        "message": f"Command failed with return code {process.returncode}",
                        "error": error_detail,
                        "command": full_command
                    }
                )

            output = stdout
            debug_info = None
            parsed_lines = []

            # Handle sorting for df command
            if request.command == 'df' and request.sortField:
                try:
                    lines = output.strip().split('\n')
                    if len(lines) > 1:
                        header = lines[0]
                        data_lines = lines[1:]
                        
                        # Get column positions from header
                        header_parts = header.split()
                        sort_index = header_parts.index(request.sortField) if request.sortField in header_parts else None
                        
                        if sort_index is not None:
                            # Parse and sort data lines
                            parsed_lines = []
                            for line in data_lines:
                                parts = line.split()
                                if len(parts) > sort_index:
                                    value = parts[sort_index]
                                    # Convert human-readable sizes to bytes for sorting
                                    if request.sortField in ['size', 'used', 'avail']:
                                        value = parse_size(value)
                                    elif request.sortField == 'use%':
                                        value = float(value.rstrip('%'))
                                    parsed_lines.append((value, line))
                            
                            # Sort based on direction
                            reverse = request.sortDirection == 'desc'
                            parsed_lines.sort(key=lambda x: x[0], reverse=reverse)
                            
                            # Reconstruct output
                            output = header + '\n' + '\n'.join(line for _, line in parsed_lines)

                            if request.debug:
                                debug_info = {
                                    'header': header,
                                    'header_length': len(header),
                                    'sort_field': request.sortField,
                                    'sort_index': sort_index,
                                    'sort_direction': request.sortDirection,
                                    'header_parts': header_parts,
                                    'parsed_lines': [{'value': str(v), 'line': l} for v, l in parsed_lines],
                                    'post_process': request.postProcess
                                }
                except Exception as e:
                    print(f"Error processing df output: {str(e)}")
                    raise HTTPException(
                        status_code=500,
                        detail={
                            "message": "Error processing df output",
                            "error": str(e),
                            "command": full_command
                        }
                    )

            # Apply post-processing commands
            if request.postProcess:
                for proc_name, proc_args in request.postProcess.items():
                    if proc_args:
                        try:
                            # For complex commands like awk, we need to handle them differently
                            if proc_args.strip().startswith('awk'):
                                # Create a shell script to execute the awk command
                                script_content = f"""#!/bin/bash
{proc_args}
"""
                                # Write the script to a temporary file
                                script_path = f"/tmp/process_{command_id}.sh"
                                with open(script_path, 'w') as f:
                                    f.write(script_content)
                                os.chmod(script_path, 0o755)  # Make it executable
                                
                                print(f"Executing post-processing script: {script_path}")
                                print(f"Script content: {script_content}")
                                
                                # Execute the script
                                proc_process = subprocess.Popen(
                                    [script_path],
                                    stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                    text=True
                                )
                            else:
                                # For simpler commands, split and execute directly
                                proc_parts = proc_args.split()
                                if proc_parts:
                                    print(f"Executing post-processing: {proc_args}")
                                    proc_process = subprocess.Popen(
                                        proc_parts,
                                        stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE,
                                        stderr=subprocess.PIPE,
                                        text=True
                                    )
                            
                            # Pipe the output through the post-processing command
                            proc_stdout, proc_stderr = proc_process.communicate(input=output)
                            
                            if proc_process.returncode == 0:
                                output = proc_stdout
                            else:
                                print(f"Post-processing failed: {proc_stderr.strip()}")
                                raise HTTPException(
                                    status_code=500,
                                    detail={
                                        "message": f"Post-processing command failed",
                                        "error": proc_stderr.strip(),
                                        "command": proc_args
                                    }
                                )
                            
                            # Clean up the temporary script if it was created
                            if proc_args.strip().startswith('awk'):
                                try:
                                    os.remove(script_path)
                                except:
                                    pass
                                    
                        except Exception as e:
                            print(f"Error in post-processing: {str(e)}")
                            raise HTTPException(
                                status_code=500,
                                detail={
                                    "message": "Error in post-processing command",
                                    "error": str(e),
                                    "command": proc_args
                                }
                            )

            return {
                "output": output,
                "debug": debug_info,
                "command_id": command_id
            }

        finally:
            # Remove the process from tracking
            if command_id in running_processes:
                del running_processes[command_id]

    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Unexpected error: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Unexpected error executing command",
                "error": str(e),
                "command": " ".join(args) if 'args' in locals() else request.command
            }
        )

@app.post("/api/fs/cancel/{command_id}")
async def cancel_command(command_id: str):
    try:
        if command_id not in running_processes:
            raise HTTPException(status_code=404, detail="Command not found")
        
        process = running_processes[command_id]
        
        # Kill the entire process group
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass  # Process already terminated
        
        # Wait a bit for the process to terminate
        try:
            process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            # If it's still running, force kill
            try:
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        
        # Remove from tracking
        del running_processes[command_id]
        
        return {"status": "cancelled"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/fs/saved-commands")
async def get_saved_commands():
    return {name: cmd.dict() for name, cmd in saved_commands.items()}

@app.post("/api/fs/save-command")
async def save_command(command: SavedCommand):
    saved_commands[command.name] = command
    save_commands(saved_commands)
    return {"status": "success", "message": f"Command '{command.name}' saved"}

@app.delete("/api/fs/saved-command/{name}")
async def delete_saved_command(name: str):
    if name in saved_commands:
        del saved_commands[name]
        save_commands(saved_commands)
        return {"status": "success", "message": f"Command '{name}' deleted"}
    raise HTTPException(status_code=404, detail=f"Command '{name}' not found")

@app.get("/api/fs/saved-scripts")
async def get_saved_scripts():
    return saved_scripts

@app.post("/api/fs/save-script")
async def save_script(script: Script):
    saved_scripts[script.name] = script.dict()
    save_scripts(saved_scripts)
    return {"status": "success"}

@app.delete("/api/fs/saved-script/{name}")
async def delete_script(name: str):
    if name in saved_scripts:
        del saved_scripts[name]
        save_scripts(saved_scripts)
    return {"status": "success"}

def stream_process_output(process, output_queue):
    """Stream process output to a queue"""
    def read_output(pipe, is_error=False):
        try:
            while True:
                line = pipe.readline()
                if not line and process.poll() is not None:
                    break
                if line:
                    output_queue.put(('error' if is_error else 'output', line.strip()))
        except Exception as e:
            print(f"Error reading {'stderr' if is_error else 'stdout'}: {str(e)}")
    
    # Create threads to read stdout and stderr
    stdout_thread = threading.Thread(target=read_output, args=(process.stdout, False))
    stderr_thread = threading.Thread(target=read_output, args=(process.stderr, True))
    
    stdout_thread.daemon = True
    stderr_thread.daemon = True
    
    stdout_thread.start()
    stderr_thread.start()
    
    # Wait for both threads to complete
    stdout_thread.join()
    stderr_thread.join()
    
    # Wait for process to complete
    process.wait()
    
    # Read any remaining output
    for line in process.stdout:
        if line:
            output_queue.put(('output', line.strip()))
    for line in process.stderr:
        if line:
            output_queue.put(('error', line.strip()))
    
    output_queue.put(('done', None))

@app.post("/api/fs/execute-script-stream")
async def execute_script_stream(script: ScriptExecution, request: Request):
    try:
        # Create a temporary script file
        script_path = f"/tmp/script_{script.name}.sh"
        print(f"Creating script file: {script_path}")  # Debug print
        
        # Determine if this is a Python script
        is_python = (
            script.name.endswith('.py') or
            script.body.strip().startswith('#!/usr/bin/env python') or
            script.body.strip().startswith('#!/usr/bin/python') or
            script.body.strip().startswith('import ') or
            script.body.strip().startswith('from ')
        )
        
        try:
            with open(script_path, 'w') as f:
                if is_python:
                    # For Python scripts, write the content as is
                    f.write(script.body)
                    # Add .py extension to the file
                    os.rename(script_path, script_path + '.py')
                    script_path += '.py'
                else:
                    # For shell scripts, add shebang
                    f.write("#!/bin/bash\n")
                    f.write(script.body)
            print(f"Script file created successfully")  # Debug print
        except Exception as e:
            print(f"Error creating script file: {str(e)}")  # Debug print
            raise HTTPException(
                status_code=500,
                detail=f"Failed to create script file: {str(e)}"
            )
        
        # Make the script executable
        try:
            os.chmod(script_path, 0o755)
            print(f"Script file permissions set to 755")  # Debug print
        except Exception as e:
            print(f"Error setting script permissions: {str(e)}")  # Debug print
            raise HTTPException(
                status_code=500,
                detail=f"Failed to set script permissions: {str(e)}"
            )
        
        # Verify the file exists and is executable
        if not os.path.exists(script_path):
            raise HTTPException(
                status_code=500,
                detail=f"Script file was not created: {script_path}"
            )
        
        if not os.access(script_path, os.X_OK):
            raise HTTPException(
                status_code=500,
                detail=f"Script file is not executable: {script_path}"
            )
        
        # Execute the script with arguments
        if is_python:
            cmd = ["/usr/bin/python3", script_path]  # Use python3 for Python scripts
        else:
            cmd = ["/bin/bash", script_path]  # Use bash for shell scripts
            
        if script.args:
            cmd.extend(shlex.split(script.args))
        
        print(f"Executing command: {' '.join(cmd)}")  # Debug print
        
        # Start the process
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        # Create a queue for output
        output_queue = asyncio.Queue()

        async def stream_process_output():
            try:
                while True:
                    # Check if client disconnected
                    if await request.is_disconnected():
                        print("Client disconnected, terminating process")
                        process.terminate()
                        break

                    # Read from stdout
                    stdout_data = await process.stdout.read(1024)
                    if stdout_data:
                        await output_queue.put(("output", stdout_data.decode()))
                    
                    # Read from stderr
                    stderr_data = await process.stderr.read(1024)
                    if stderr_data:
                        await output_queue.put(("error", stderr_data.decode()))

                    # Check if process is done
                    if process.stdout.at_eof() and process.stderr.at_eof():
                        break

                    # Small delay to prevent busy waiting
                    await asyncio.sleep(0.1)

                # Get return code
                return_code = await process.wait()
                if return_code != 0:
                    await output_queue.put(("error", f"Process exited with code {return_code}"))
            except Exception as e:
                print(f"Error in stream_process_output: {e}")
                await output_queue.put(("error", f"Error: {str(e)}"))
            finally:
                # Clean up the script file
                try:
                    os.remove(script_path)
                except Exception as e:
                    print(f"Error removing script file: {e}")

        # Start the output streaming task
        stream_task = asyncio.create_task(stream_process_output())

        async def event_generator():
            try:
                while True:
                    # Check if client disconnected
                    if await request.is_disconnected():
                        print("Client disconnected in event_generator")
                        break

                    try:
                        # Get message from queue with timeout
                        event_type, data = await asyncio.wait_for(output_queue.get(), timeout=0.1)
                        
                        # Format the data for SSE
                        formatted_data = data.replace('\n', '\\n')
                        yield f"event: {event_type}\ndata: {formatted_data}\n\n"
                        
                        # Mark task as done
                        output_queue.task_done()
                    except asyncio.TimeoutError:
                        # No data available, check if process is still running
                        if process.returncode is not None:
                            # Process is done, check if there's any remaining output
                            if output_queue.empty():
                                break
                        continue
                    except Exception as e:
                        print(f"Error in event_generator: {e}")
                        yield f"event: error\ndata: Error: {str(e)}\n\n"
                        break

                # Send final event
                yield "event: done\ndata: Script execution completed\n\n"
            except Exception as e:
                print(f"Error in event_generator: {e}")
                yield f"event: error\ndata: Error: {str(e)}\n\n"
            finally:
                # Cancel the stream task if it's still running
                if not stream_task.done():
                    stream_task.cancel()
                    try:
                        await stream_task
                    except asyncio.CancelledError:
                        pass

        return StreamingResponse(
            event_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )
    except Exception as e:
        print(f"Error in execute_script_stream: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001) 