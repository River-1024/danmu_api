const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const bodyParser = require('body-parser');

const app = express();
const port = 3000;

app.use(bodyParser.json());
app.use(express.static(__dirname));

const envFilePath = path.join(__dirname, '.env');
const LOG_DIR = path.join(__dirname, 'data', 'logs'); // 新的日志目录

// 提供前端页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '弹幕API配置管理中心.html'));
});

// 获取当前配置
app.get('/api/config', async (req, res) => {
    try {
        const data = await fs.readFile(envFilePath, 'utf8');
        const config = {};
        data.split('\n').forEach(line => {
            if (line && !line.startsWith('#')) {
                const [key, ...valueParts] = line.split('=');
                const value = valueParts.join('=');
                if (key) {
                    config[key.trim()] = value.trim();
                }
            }
        });
        res.json(config);
    } catch (error) {
        if (error.code === 'ENOENT') {
            res.json({});
        } else {
            res.status(500).send('Error reading config file');
        }
    }
});

// 保存配置
app.post('/api/config', async (req, res) => {
    try {
        const config = req.body;
        let envContent = '';
        for (const key in config) {
            envContent += `${key}=${config[key]}\n`;
        }
        await fs.writeFile(envFilePath, envContent, 'utf8');
        res.send('Configuration saved successfully');
    } catch (error) {
        res.status(500).send('Error writing config file');
    }
});

// 获取日志
app.get('/api/logs', async (req, res) => {
    try {
        // 确保日志目录存在
        await fs.mkdir(LOG_DIR, { recursive: true });

        const files = await fs.readdir(LOG_DIR);
        const logFiles = files.filter(file => file.endsWith('.log')).sort().reverse(); // 按日期降序排列

        if (logFiles.length === 0) {
            return res.send(''); // 没有日志文件
        }

        // 读取最新的日志文件
        const latestLogFile = path.join(LOG_DIR, logFiles[0]);
        const data = await fs.readFile(latestLogFile, 'utf8');
        res.send(data);
    } catch (error) {
        console.error('Error reading log file:', error);
        if (error.code === 'ENOENT') {
            res.send('');
        } else {
            res.status(500).send('Error reading log file');
        }
    }
});

// 重启服务
app.post('/api/restart', (req, res) => {
    console.log('Restarting API server...');
    // 这里我们假设主服务是通过 npm start 启动的
    // 在生产环境中，你可能需要一个更健壮的进程管理器，如 pm2
    exec('npm start', (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).send('Failed to restart server');
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
    });
    res.send('Server is restarting...');
});


app.listen(port, () => {
    console.log(`Admin server listening at http://localhost:${port}`);
});
