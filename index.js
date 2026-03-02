require('dotenv').config();
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    AttachmentBuilder,
    EmbedBuilder
} = require('discord.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages]
});

const ALLOWED_ROLE_ID = "1471073279065329785";
const DATA_FILE = path.join(__dirname, 'tickets.json');
const TEMPLATE_FILE = path.join(__dirname, 'template.html');

let tickets = {};
if (fs.existsSync(DATA_FILE)) {
    tickets = JSON.parse(fs.readFileSync(DATA_FILE));
}

function saveTickets() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));
}

function generateID(product) {
    const random = Math.random().toString(36).substring(2, 7);
    const prefix = product.includes("Polaris") ? "polaris" : "tracker";
    return `${prefix}-${random}`;
}

async function generatePDF(data) {
    try {
        let html = fs.readFileSync(TEMPLATE_FILE, 'utf8');

        html = html
            .replace('{{CLIENT_NAME}}', data.client_name)
            .replace('{{PRODUCT}}', data.product)
            .replace('{{ORDER_ID}}', data.id)
            .replace('{{REQUESTS}}', data.requests);

        const browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfPath = path.join(__dirname, `${data.id}.pdf`);

        await page.pdf({
            path: pdfPath,
            format: 'A4',
            printBackground: true
        });

        await browser.close();
        return pdfPath;

    } catch (err) {
        console.error("PDF ERROR:", err);
        return null;
    }
}

client.once('ready', async () => {

    const commands = [

        new SlashCommandBuilder()
            .setName('addticket')
            .setDescription('Add a new ticket')
            .addStringOption(o =>
                o.setName('client')
                    .setDescription('Client Name')
                    .setRequired(true))
            .addStringOption(o =>
                o.setName('product')
                    .setDescription('Product')
                    .setRequired(true)
                    .addChoices(
                        { name: 'VACompanyPolaris™', value: 'VACompanyPolaris™' },
                        { name: 'VACompany Tracker™', value: 'VACompany Tracker™' }
                    ))
            .addStringOption(o =>
                o.setName('status')
                    .setDescription('Status')
                    .setRequired(true)
                    .addChoices(
                        { name: 'In Production Phase', value: 'In Production Phase' },
                        { name: 'In Test Phase', value: 'In Test Phase' },
                        { name: 'Handed off to VA for testing', value: 'Handed off to VA for testing' },
                        { name: 'Test Completed', value: 'Test Completed' }
                    ))
            .addStringOption(o =>
                o.setName('requests')
                    .setDescription('Client Requests')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('completeorder')
            .setDescription('Complete order & send document')
            .addStringOption(o =>
                o.setName('id')
                    .setDescription('Order ID')
                    .setRequired(true))
            .addUserOption(o =>
                o.setName('user')
                    .setDescription('Client Discord User')
                    .setRequired(true)),

        new SlashCommandBuilder()
            .setName('status')
            .setDescription('Check status')
            .addStringOption(o =>
                o.setName('id')
                    .setDescription('Order ID')
                    .setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
    );

    console.log("Bot Ready");
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    try {

        if (interaction.commandName === 'addticket') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "No permission.", ephemeral: true });

            const id = generateID(interaction.options.getString('product'));

            tickets[id] = {
                id,
                client_name: interaction.options.getString('client'),
                product: interaction.options.getString('product'),
                status: interaction.options.getString('status'),
                requests: interaction.options.getString('requests')
            };

            saveTickets();

            return interaction.reply({ content: `Ticket created: ${id}`, ephemeral: true });
        }

        if (interaction.commandName === 'completeorder') {

            if (!interaction.member.roles.cache.has(ALLOWED_ROLE_ID))
                return interaction.reply({ content: "No permission.", ephemeral: true });

            await interaction.deferReply({ ephemeral: true });

            const id = interaction.options.getString('id');
            const user = interaction.options.getUser('user');

            if (!tickets[id])
                return interaction.editReply("Order not found.");

            tickets[id].status = "Processed";
            saveTickets();

            const pdfPath = await generatePDF(tickets[id]);

            if (!pdfPath)
                return interaction.editReply("PDF generation failed.");

            const attachment = new AttachmentBuilder(pdfPath);

            await user.send({
                content: "Your order has been completed. Here is your document:",
                files: [attachment]
            });

            await interaction.editReply("Order completed and document sent.");

            if (fs.existsSync(pdfPath))
                fs.unlinkSync(pdfPath);
        }

        if (interaction.commandName === 'status') {

            const id = interaction.options.getString('id');

            if (!tickets[id])
                return interaction.reply({ content: "Order not found.", ephemeral: true });

            const embed = new EmbedBuilder()
                .setTitle("🗃️ Order Status")
                .addFields(
                    { name: "Order ID", value: tickets[id].id },
                    { name: "Name", value: tickets[id].client_name },
                    { name: "Product", value: tickets[id].product },
                    { name: "Status", value: tickets[id].status }
                )
                .setColor("Blue");

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

    } catch (err) {
        console.error("COMMAND ERROR:", err);

        if (interaction.deferred)
            return interaction.editReply("An unexpected error occurred.");
        else
            return interaction.reply({ content: "An unexpected error occurred.", ephemeral: true });
    }
});

client.login(process.env.TOKEN);
